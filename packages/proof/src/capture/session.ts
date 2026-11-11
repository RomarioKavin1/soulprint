/**
 * Capture session (A27): every frame is linked into the chain at capture and queued for upload
 * immediately; review only changes visibility on the server. Discarding deletes the image and
 * keeps the hash. Device time must not run backwards within a session.
 */
import { sha256 } from "@noble/hashes/sha256";
import { frameRecordHash, genesis, linkHash } from "../chain.ts";
import { hex } from "../encoding.ts";
import type { Signer } from "../keys.ts";
import { anchorMessage, batchMessage } from "../messages.ts";
import type { IdbFrameStore, StoredFrame } from "./store.ts";

export interface FrameSource {
  grab(): Promise<{ jpeg: Uint8Array; width: number; height: number }>;
  stop(): Promise<void>;
}

export interface UploadFrame {
  index: number;
  sessionId: string;
  deviceTs: number;
  jpegHash: Uint8Array;
  link: Uint8Array;
  jpeg: Uint8Array | null;
  width: number;
  height: number;
}

export interface UploadBatch {
  pieceId: string;
  key: Uint8Array;
  fromIndex: number;
  toIndex: number;
  /** Capture-key signature over BatchMessage (authenticates the upload). */
  sig: Uint8Array;
  /** Capture-key signature over AnchorMessage(head, toIndex + 1): the service may anchor this head. */
  anchorSig: Uint8Array;
  frames: UploadFrame[];
}

export interface Uploader {
  upload(batch: UploadBatch): Promise<void>;
  discard(pieceId: string, key: Uint8Array, indices: number[]): Promise<void>;
}

export class ClockError extends Error {
  constructor(last: number, now: number) {
    super(`device clock went backwards (${now} < ${last}); stop and start a new session`);
  }
}

interface Timers {
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}
interface WakeLockLike {
  request(type: "screen"): Promise<{ release(): Promise<void> }>;
}
interface VisibilityDoc extends EventTarget {
  visibilityState: string;
}

export interface SessionOptions {
  pieceId: string;
  signer: Signer;
  store: IdbFrameStore;
  uploader: Uploader;
  clock?: () => number;
  batchSize?: number;
  doc?: VisibilityDoc;
  timers?: Timers;
  wakeLock?: WakeLockLike;
  /** Called after background capture/upload errors (UI shows status + retry). */
  onError?: (e: unknown) => void;
}

export interface CaptureStatus {
  capturing: boolean;
  paused: boolean;
  pending: number;
  uploaded: number;
  lastError: string | null;
  count: number;
}

export class CaptureSession {
  readonly sessionId = hex.encode(crypto.getRandomValues(new Uint8Array(8)));
  private source: FrameSource | null = null;
  private lastTs: number | null = null;
  private count = 0;
  private head: Uint8Array;
  private pending = 0;
  private uploaded = 0;
  private lastError: string | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  private intervalMs = 0;
  private started = false;
  private paused = false;
  private wake: { release(): Promise<void> } | null = null;
  private readonly onVisibility = () => void this.visibilityChanged();
  /** Lowest index not yet uploaded. */
  private nextUpload = 0;

  private constructor(private o: Required<Pick<SessionOptions, "clock" | "batchSize">> & SessionOptions) {
    this.head = genesis(o.pieceId, o.signer.publicKey);
  }

  static async open(o: SessionOptions): Promise<CaptureSession> {
    const s = new CaptureSession({ clock: Date.now, batchSize: 20, ...o });
    const h = await o.store.head(o.pieceId, o.signer.publicKey);
    s.count = h.count;
    if (h.head) s.head = h.head;
    // Uploads go in index order, so uploaded frames are a prefix; images of uploaded frames are freed.
    const frames = await o.store.frames(o.pieceId, o.signer.publicKey);
    s.uploaded = frames.filter((f) => f.uploaded).length;
    s.pending = frames.length - s.uploaded;
    s.nextUpload = frames.find((f) => !f.uploaded)?.index ?? s.count;
    return s;
  }

  attach(source: FrameSource) {
    this.source = source;
  }

  /**
   * Timed capture holding a screen wake lock while visible. `pauseWhenHidden` (camera capture on a
   * phone left unattended) pauses while the page is hidden; screen capture keeps running because
   * the artist works in another window (Plan 2 review I4).
   */
  async start(source: FrameSource, opts: { intervalMs: number; pauseWhenHidden?: boolean }) {
    this.attach(source);
    this.intervalMs = opts.intervalMs;
    this.started = true;
    if (opts.pauseWhenHidden) this.o.doc?.addEventListener("visibilitychange", this.onVisibility);
    await this.resume();
  }

  async stop() {
    this.started = false;
    this.o.doc?.removeEventListener("visibilitychange", this.onVisibility);
    await this.pause();
    this.paused = false;
    await this.lock.catch(() => {});
    await this.source?.stop();
    this.source = null;
  }

  status(): CaptureStatus {
    return { capturing: this.started, paused: this.paused, pending: this.pending, uploaded: this.uploaded, lastError: this.lastError, count: this.count };
  }

  captureNow(): Promise<StoredFrame> {
    return this.serial(async () => {
      if (!this.source) throw new Error("no frame source");
      const shot = await this.source.grab();
      const ts = this.o.clock();
      if (this.lastTs !== null && ts < this.lastTs) throw new ClockError(this.lastTs, ts);
      const jpegHash = sha256(shot.jpeg);
      const index = this.count;
      const link = linkHash(this.head, frameRecordHash(jpegHash, index, ts));
      const f: StoredFrame = {
        pieceId: this.o.pieceId, keyHex: hex.encode(this.o.signer.publicKey), index, sessionId: this.sessionId,
        deviceTs: ts, jpegHash, link, jpeg: shot.jpeg, width: shot.width, height: shot.height, uploaded: false, discarded: false,
      };
      await this.o.store.append(f);
      this.count++;
      this.head = link;
      this.lastTs = ts;
      this.pending++;
      return f;
    });
  }

  /** Uploads pending frames in index order, in signed batches. Throws (and records) on failure. */
  flush(): Promise<void> {
    return this.serial(async () => {
      const { pieceId, signer, uploader, store, batchSize } = this.o;
      try {
        for (;;) {
          // Review I5: read only the next batch from the first pending frame, not the whole history.
          const chunk = (await store.frames(pieceId, signer.publicKey, this.nextUpload, batchSize)).filter((f) => !f.uploaded);
          if (!chunk.length) break;
          const from = chunk[0]!.index, to = chunk.at(-1)!.index, head = chunk.at(-1)!.link;
          const batch: UploadBatch = {
            pieceId, key: signer.publicKey, fromIndex: from, toIndex: to,
            sig: await signer.sign(batchMessage({ pieceId, key: signer.publicKey, fromIndex: from, toIndex: to, head })),
            anchorSig: await signer.sign(anchorMessage({ pieceId, head, count: to + 1 })),
            frames: chunk.map(({ index, sessionId, deviceTs, jpegHash, link, jpeg, width, height }) => ({ index, sessionId, deviceTs, jpegHash, link, jpeg, width, height })),
          };
          await uploader.upload(batch);
          // The server has the image now; keep only hash and link locally (review I5).
          await store.update(pieceId, signer.publicKey, chunk.map((f) => f.index), (f) => { f.uploaded = true; f.jpeg = null; });
          this.nextUpload = to + 1;
          this.pending -= chunk.length;
          this.uploaded += chunk.length;
        }
        this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        throw e;
      }
    });
  }

  /** Deletes images (locally and, if uploaded, on the server); hashes stay in the chain. */
  discard(indices: number[]): Promise<void> {
    return this.serial(async () => {
      const { pieceId, signer, store, uploader } = this.o;
      const changed = await store.update(pieceId, signer.publicKey, indices, (f) => { f.jpeg = null; f.discarded = true; });
      const remote = changed.filter((f) => f.uploaded).map((f) => f.index);
      if (remote.length) await uploader.discard(pieceId, signer.publicKey, remote);
    });
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const r = this.lock.catch(() => {}).then(f);
    this.lock = r;
    return r;
  }

  private async tick() {
    try {
      await this.captureNow();
      await this.flush();
    } catch (e) {
      this.o.onError?.(e);
    }
  }

  private async visibilityChanged() {
    if (!this.started) return;
    if (this.o.doc?.visibilityState === "hidden") await this.pause();
    else await this.resume();
  }

  private async pause() {
    if (this.timer !== null) (this.o.timers ?? globalThis).clearInterval(this.timer as number);
    this.timer = null;
    this.paused = this.started;
    const w = this.wake;
    this.wake = null;
    await w?.release().catch(() => {});
  }

  private async resume() {
    this.paused = false;
    if (this.timer === null) this.timer = (this.o.timers ?? globalThis).setInterval(() => void this.tick(), this.intervalMs);
    const wl = this.o.wakeLock ?? (globalThis.navigator as { wakeLock?: WakeLockLike } | undefined)?.wakeLock;
    if (wl && !this.wake) this.wake = await wl.request("screen").catch(() => null);
  }
}

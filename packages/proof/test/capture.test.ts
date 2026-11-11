import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import {
  anchorMessage, batchMessage, genesis, nobleSigner, verifyChain, verifySig, type Signer,
} from "../src/index.ts";
import { CaptureSession, ClockError, IdbFrameStore, type FrameSource, type SessionOptions, type UploadBatch, type Uploader } from "../src/capture/index.ts";

const PIECE = "p1.soulprint.test.near";

class FakeSource implements FrameSource {
  n = 0;
  async grab() {
    this.n++;
    return { jpeg: new Uint8Array([0xff, 0xd8, this.n, 0xff, 0xd9]), width: 1600, height: 1200 };
  }
  async stop() {}
}

class FakeUploader implements Uploader {
  batches: UploadBatch[] = [];
  discarded: number[][] = [];
  failNext = 0;
  async upload(b: UploadBatch) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("offline");
    }
    this.batches.push(b);
  }
  async discard(_pieceId: string, _key: Uint8Array, indices: number[]) {
    this.discarded.push(indices);
  }
}

class FakeDoc extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  set(v: "visible" | "hidden") {
    this.visibilityState = v;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

let signer: Signer;
let now: number;
const clock = () => now;
let dbn = 0;
const freshStore = () => new IdbFrameStore(`test-${dbn++}`);

beforeEach(async () => {
  signer = await nobleSigner(new Uint8Array(32).fill(42));
  now = 1_700_000_000_000;
});

const open = (store: IdbFrameStore, up: FakeUploader, extra: Partial<SessionOptions> = {}) =>
  CaptureSession.open({ pieceId: PIECE, signer, store, uploader: up, clock, batchSize: 3, ...extra });

describe("CaptureSession", () => {
  it("frames_chain_in_order_across_restart", async () => {
    const store = freshStore(), up = new FakeUploader(), src = new FakeSource();
    const a = await open(store, up);
    a.attach(src);
    for (let i = 0; i < 4; i++) { now += 60_000; await a.captureNow(); }
    await a.stop();
    // A new tab / reload: the chain continues from the stored head.
    const b = await open(store, up);
    b.attach(src);
    for (let i = 0; i < 3; i++) { now += 60_000; await b.captureNow(); }
    await b.flush();
    const frames = await store.frames(PIECE, signer.publicKey);
    expect(frames.map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(verifyChain(frames, genesis(PIECE, signer.publicKey))).toEqual({ ok: true });
    expect(new Set(frames.map((f) => f.sessionId)).size).toBe(2);
    expect(frames[0]!.jpegHash).toEqual(sha256(new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9])));
  });

  it("batches_are_signed_and_carry_an_anchor_signature", async () => {
    const store = freshStore(), up = new FakeUploader();
    const s = await open(store, up);
    s.attach(new FakeSource());
    for (let i = 0; i < 5; i++) { now += 1000; await s.captureNow(); }
    await s.flush();
    expect(up.batches.map((b) => [b.fromIndex, b.toIndex])).toEqual([[0, 2], [3, 4]]);
    for (const b of up.batches) {
      const head = b.frames.at(-1)!.link;
      expect(await verifySig(b.sig, batchMessage({ pieceId: PIECE, key: signer.publicKey, fromIndex: b.fromIndex, toIndex: b.toIndex, head }), signer.publicKey)).toBe(true);
      expect(await verifySig(b.anchorSig, anchorMessage({ pieceId: PIECE, head, count: b.toIndex + 1 }), signer.publicKey)).toBe(true);
    }
  });

  it("discard_keeps_hash_drops_image", async () => {
    const store = freshStore(), up = new FakeUploader();
    const s = await open(store, up);
    s.attach(new FakeSource());
    for (let i = 0; i < 3; i++) { now += 1000; await s.captureNow(); }
    await s.flush();
    await s.discard([1]);
    const frames = await store.frames(PIECE, signer.publicKey);
    expect(frames[1]!.jpeg).toBeNull();
    expect(frames[1]!.discarded).toBe(true);
    expect(frames[1]!.jpegHash.length).toBe(32);
    expect(verifyChain(frames, genesis(PIECE, signer.publicKey))).toEqual({ ok: true });
    expect(up.discarded).toEqual([[1]]);
    // A frame discarded before upload is uploaded as hash-only.
    now += 1000; await s.captureNow();
    await s.discard([3]);
    await s.flush();
    const last = up.batches.at(-1)!.frames.find((f) => f.index === 3)!;
    expect(last.jpeg).toBeNull();
  });

  it("offline_queue_flushes_in_order", async () => {
    const store = freshStore(), up = new FakeUploader();
    up.failNext = 2;
    const s = await open(store, up);
    s.attach(new FakeSource());
    for (let i = 0; i < 4; i++) { now += 1000; await s.captureNow(); }
    await expect(s.flush()).rejects.toThrow("offline");
    expect(s.status().pending).toBe(4);
    expect(s.status().lastError).toBe("offline");
    await expect(s.flush()).rejects.toThrow("offline");
    await s.flush();
    expect(s.status()).toMatchObject({ pending: 0, uploaded: 4, lastError: null });
    expect(up.batches.flatMap((b) => b.frames.map((f) => f.index))).toEqual([0, 1, 2, 3]);
  });

  it("uploaded_images_are_freed_and_flush_reads_only_pending (Plan 2 review I5)", async () => {
    const store = freshStore(), up = new FakeUploader();
    const s = await open(store, up);
    s.attach(new FakeSource());
    for (let i = 0; i < 5; i++) { now += 1000; await s.captureNow(); }
    await s.flush();
    const kept = await store.frames(PIECE, signer.publicKey);
    expect(kept.map((f) => [f.uploaded, f.jpeg])).toEqual(kept.map(() => [true, null]));
    expect(kept.every((f) => f.jpegHash.length === 32 && f.link.length === 32)).toBe(true);
    // Later flushes read from the first pending frame on, not the whole history.
    const reads: number[] = [];
    const orig = store.frames.bind(store);
    store.frames = (p, k, from = 0, limit) => (reads.push(from), orig(p, k, from, limit));
    now += 1000; await s.captureNow();
    await s.flush();
    expect(reads.length).toBeGreaterThan(0);
    expect(Math.min(...reads)).toBe(5);
    // Reopening keeps the counts.
    expect((await open(store, up)).status()).toMatchObject({ pending: 0, uploaded: 6 });
  });

  it("clock_set_backwards_rejected_within_session", async () => {
    const store = freshStore(), up = new FakeUploader();
    const s = await open(store, up);
    s.attach(new FakeSource());
    now += 1000; await s.captureNow();
    now -= 3_600_000; // user moved the clock back an hour
    await expect(s.captureNow()).rejects.toBeInstanceOf(ClockError);
    expect((await store.frames(PIECE, signer.publicKey)).length).toBe(1);
    await s.stop();
    // A new session may start from the corrected clock; the chain stays valid.
    const t = await open(store, up);
    t.attach(new FakeSource());
    await t.captureNow();
    const frames = await store.frames(PIECE, signer.publicKey);
    expect(frames.length).toBe(2);
    expect(verifyChain(frames, genesis(PIECE, signer.publicKey))).toEqual({ ok: true });
  });

  it("capture_pauses_and_resumes_on_visibility", async () => {
    const store = freshStore(), up = new FakeUploader(), doc = new FakeDoc();
    let ticks: (() => void) | null = null;
    const timers = {
      setInterval: (f: () => void) => { ticks = f; return 1; },
      clearInterval: () => { ticks = null; },
    };
    const lock = { released: 0, requested: 0 };
    const wakeLock = { request: async () => { lock.requested++; return { release: async () => { lock.released++; } }; } };
    const s = await open(store, up, { doc, timers, wakeLock });
    await s.start(new FakeSource(), { intervalMs: 60_000, pauseWhenHidden: true });
    expect(lock.requested).toBe(1);
    expect(ticks).not.toBeNull();
    doc.set("hidden");
    expect(ticks).toBeNull();
    expect(s.status().paused).toBe(true);
    doc.set("visible");
    expect(ticks).not.toBeNull();
    expect(lock.requested).toBe(2); // wake locks are dropped when hidden; re-acquired on return
    await s.stop();
    expect(ticks).toBeNull();
    expect(lock.released).toBeGreaterThanOrEqual(1);
  });

  it("screen_capture_keeps_running_while_the_tab_is_hidden (Plan 2 review I4)", async () => {
    // The artist shares a window and switches to their art tool: the page is hidden, capture goes on.
    const store = freshStore(), up = new FakeUploader(), doc = new FakeDoc();
    let ticks: (() => void) | null = null;
    const timers = { setInterval: (f: () => void) => { ticks = f; return 1; }, clearInterval: () => { ticks = null; } };
    const s = await open(store, up, { doc, timers });
    await s.start(new FakeSource(), { intervalMs: 60_000 });
    doc.set("hidden");
    expect(ticks).not.toBeNull();
    expect(s.status().paused).toBe(false);
    await s.stop();
  });
});

/** IndexedDB persistence for captured frames and per-(piece, key) chain heads. */
import { hex } from "../encoding.ts";

export interface StoredFrame {
  pieceId: string;
  keyHex: string;
  index: number;
  sessionId: string;
  deviceTs: number;
  jpegHash: Uint8Array;
  link: Uint8Array;
  /** Null once discarded (A27: the hash stays in the chain, the image goes). */
  jpeg: Uint8Array | null;
  width: number;
  height: number;
  uploaded: boolean;
  discarded: boolean;
}

export interface ChainHead {
  pieceId: string;
  keyHex: string;
  count: number;
  head: Uint8Array | null;
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, err) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
const done = (t: IDBTransaction) =>
  new Promise<void>((ok, err) => {
    t.oncomplete = () => ok();
    t.onerror = () => err(t.error);
    t.onabort = () => err(t.error);
  });

export class IdbFrameStore {
  private db: Promise<IDBDatabase>;
  constructor(name = "soulprint-capture") {
    this.db = new Promise((ok, err) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("frames", { keyPath: ["pieceId", "keyHex", "index"] });
        r.result.createObjectStore("heads", { keyPath: ["pieceId", "keyHex"] });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }

  async head(pieceId: string, key: Uint8Array): Promise<ChainHead> {
    const keyHex = hex.encode(key);
    const t = (await this.db).transaction("heads", "readonly");
    const h = (await req(t.objectStore("heads").get([pieceId, keyHex]))) as ChainHead | undefined;
    return h ?? { pieceId, keyHex, count: 0, head: null };
  }

  /** Appends a frame and advances the head atomically. */
  async append(f: StoredFrame): Promise<void> {
    const t = (await this.db).transaction(["frames", "heads"], "readwrite");
    t.objectStore("frames").add(f);
    t.objectStore("heads").put({ pieceId: f.pieceId, keyHex: f.keyHex, count: f.index + 1, head: f.link } satisfies ChainHead);
    await done(t);
  }

  /** Frames from index `from` on, at most `limit` (review I5: never the whole history per tick). */
  async frames(pieceId: string, key: Uint8Array, from = 0, limit?: number): Promise<StoredFrame[]> {
    const keyHex = hex.encode(key);
    const t = (await this.db).transaction("frames", "readonly");
    const range = IDBKeyRange.bound([pieceId, keyHex, from], [pieceId, keyHex, Number.MAX_SAFE_INTEGER]);
    return (await req(t.objectStore("frames").getAll(range, limit))) as StoredFrame[];
  }

  /** Frames of this piece (any capture key) still waiting to upload from this device (Plan 3 review I4). */
  async pendingCount(pieceId: string): Promise<number> {
    const t = (await this.db).transaction("frames", "readonly");
    const range = IDBKeyRange.bound([pieceId, "", 0], [pieceId, "\uffff", Number.MAX_SAFE_INTEGER]);
    const all = (await req(t.objectStore("frames").getAll(range))) as StoredFrame[];
    return all.filter((f) => !f.uploaded).length;
  }

  async update(pieceId: string, key: Uint8Array, indices: number[], f: (s: StoredFrame) => void): Promise<StoredFrame[]> {
    const keyHex = hex.encode(key);
    const t = (await this.db).transaction("frames", "readwrite");
    const s = t.objectStore("frames");
    const out: StoredFrame[] = [];
    for (const i of indices) {
      const fr = (await req(s.get([pieceId, keyHex, i]))) as StoredFrame | undefined;
      if (!fr) continue;
      f(fr);
      s.put(fr);
      out.push(fr);
    }
    await done(t);
    return out;
  }
}

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureSession, IdbFrameStore, type FrameSource } from "@soulprint/proof/capture";
import { PIECE, nep413, world } from "../../../services/evidence/test/helpers.ts";
import { HttpUploader, captureStatusView } from "../lib/uploader.ts";

class Src implements FrameSource {
  n = 0;
  async grab() {
    this.n++;
    return { jpeg: new Uint8Array([0xff, 0xd8, 0x55, this.n, 0xff, 0xd9]), width: 4, height: 3 };
  }
  async stop() {}
}

const closers: (() => Promise<unknown>)[] = [];
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // fresh device per test
});
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function setup() {
  const w = await world();
  await w.app.listen({ port: 0, host: "127.0.0.1" });
  closers.push(() => w.app.close());
  const addr = w.app.server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  return { ...w, base };
}

describe("capture upload", () => {
  it("discarded_frames_not_kept: image removed from the service, hash stays in the chain", async () => {
    const w = await setup();
    const s = await CaptureSession.open({ pieceId: PIECE, signer: w.dev.signer, store: new IdbFrameStore(), uploader: new HttpUploader(w.base, w.dev.signer), batchSize: 2 });
    s.attach(new Src());
    for (let i = 0; i < 3; i++) await s.captureNow();
    await s.flush();
    expect(s.status()).toMatchObject({ uploaded: 3, pending: 0 });
    await s.discard([1]);
    const path = `/pieces/${PIECE}/progress`;
    const r = await fetch(w.base + path, { headers: { authorization: await nep413(w.artist, "GET", path, undefined) } });
    const frames = (await r.json()).frames;
    expect(frames.map((f: any) => [f.index, f.discarded, f.jpeg !== null])).toEqual([[0, false, true], [1, true, false], [2, false, true]]);
    expect(frames[1].jpegHash).toBeTruthy();
  });

  it("capture_upload_retry_visible: an offline upload is shown with a retry, then recovers", async () => {
    const w = await setup();
    let offline = true;
    const flaky: typeof fetch = (input, init) => (offline ? Promise.reject(new TypeError("fetch failed")) : fetch(input, init));
    const s = await CaptureSession.open({ pieceId: PIECE, signer: w.dev.signer, store: new IdbFrameStore(), uploader: new HttpUploader(w.base, w.dev.signer, flaky) });
    s.attach(new Src());
    await s.captureNow();
    await s.captureNow();
    await expect(s.flush()).rejects.toThrow(/No connection/);
    const v = captureStatusView(s.status());
    expect(v.showRetry).toBe(true);
    expect(v.problem).toMatch(/2 frames on this device not uploaded yet/);
    offline = false;
    await s.flush();
    const after = captureStatusView(s.status());
    expect(after.showRetry).toBe(false);
    expect(after.progress).toBe("2 of 2 frames saved to the record");
  });

  it("capture_upload_retry_visible after reopen: frames left on the device are retried and shown (Plan 3 review I4)", async () => {
    const w = await setup();
    let offline = true;
    const flaky: typeof fetch = (input, init) => (offline ? Promise.reject(new TypeError("fetch failed")) : fetch(input, init));
    const store = new IdbFrameStore();
    const a = await CaptureSession.open({ pieceId: PIECE, signer: w.dev.signer, store, uploader: new HttpUploader(w.base, w.dev.signer, flaky) });
    a.attach(new Src());
    await a.captureNow();
    await a.captureNow();
    await expect(a.flush()).rejects.toThrow();
    // The tab is closed and reopened later, still offline: the problem and the retry are visible at once.
    const b = await CaptureSession.open({ pieceId: PIECE, signer: w.dev.signer, store, uploader: new HttpUploader(w.base, w.dev.signer, flaky) });
    await b.flush().catch(() => undefined);
    const v = captureStatusView(b.status());
    expect(v.problem).toMatch(/2 frames/);
    expect(v.showRetry).toBe(true);
    // The deliver step can see that this device still holds frames.
    expect(await store.pendingCount(PIECE)).toBe(2);
    // Back online: reopening uploads them without the artist starting a new recording.
    offline = false;
    const c = await CaptureSession.open({ pieceId: PIECE, signer: w.dev.signer, store, uploader: new HttpUploader(w.base, w.dev.signer, flaky) });
    await c.idle();
    expect(c.status()).toMatchObject({ pending: 0, uploaded: 2 });
    expect(await store.pendingCount(PIECE)).toBe(0);
  });

  it("frames waiting on the device are shown even without an error yet (Plan 3 review I4)", () => {
    const v = captureStatusView({ capturing: false, paused: false, pending: 3, uploaded: 5, lastError: null, count: 8 });
    expect(v.problem).toMatch(/3 frames/);
    expect(v.showRetry).toBe(true);
  });
});

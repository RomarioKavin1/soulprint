import { describe, expect, it } from "vitest";
import { b64 } from "@soulprint/proof";
import { sha256 } from "@noble/hashes/sha256";
import { nep413, PIECE, world , tinyImage } from "./helpers.ts";

async function seeded() {
  const w = await world();
  w.dev.capture(3);
  await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/frames`, payload: await w.dev.batch(0, 2) });
  return w;
}
const call = async (w: any, who: any, method: "GET" | "POST", url: string, body?: unknown) =>
  w.app.inject({ method, url, payload: body as any, headers: who ? { authorization: await nep413(who, method, url, body) } : {} });

describe("endpoint auth", () => {
  it("visibility: artist only; client sees only approved frames, decrypted", async () => {
    const w = await seeded();
    const vis = `/pieces/${PIECE}/visibility`;
    expect((await call(w, w.client, "POST", vis, { indices: [1], level: "client" })).statusCode).toBe(403);
    expect((await call(w, null, "POST", vis, { indices: [1], level: "client" })).statusCode).toBe(401);
    expect((await call(w, w.artist, "POST", vis, { indices: [1], level: "client" })).statusCode).toBe(200);
    const prog = `/pieces/${PIECE}/progress`;
    const c = await call(w, w.client, "GET", prog);
    expect(c.statusCode).toBe(200);
    expect(c.json().frames.map((f: any) => f.index)).toEqual([1]);
    expect(b64.decode(c.json().frames[0].jpeg)).toEqual(w.dev.frames[1]!.jpeg);
    expect((await call(w, w.artist, "GET", prog)).json().frames.map((f: any) => f.index)).toEqual([0, 1, 2]);
    expect((await call(w, w.stranger, "GET", prog)).statusCode).toBe(403);
  });

  it("frame images: public only once published; discarded images are gone, hashes stay", async () => {
    const w = await seeded();
    const img = `/pieces/${PIECE}/frames/${encodeURIComponent(b64.encode(w.dev.signer.publicKey))}/2`;
    expect((await call(w, null, "GET", img)).statusCode).toBe(403);
    await call(w, w.artist, "POST", `/pieces/${PIECE}/visibility`, { indices: [2], level: "public" });
    const r = await call(w, null, "GET", img);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    // Discard via the capture key.
    const msg = `soulprint-discard-v1:${PIECE}:2`;
    const sig = b64.encode(await w.dev.signer.sign(new TextEncoder().encode(msg)));
    const d = await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/discard`, payload: { key: (await import("@soulprint/proof")).nearPublicKey(w.dev.signer.publicKey), indices: [2], sig } });
    expect(d.statusCode).toBe(200);
    expect((await call(w, null, "GET", img)).statusCode).toBe(410);
    const all = (await call(w, w.artist, "GET", `/pieces/${PIECE}/progress`)).json().frames;
    expect(all.find((f: any) => f.index === 2)).toMatchObject({ discarded: true, jpeg: null });
    expect(all.find((f: any) => f.index === 2).jpegHash).toBe(b64.encode(w.dev.frames[2]!.jpegHash));
    // A discard signed by anything else is refused.
    const bad = await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/discard`, payload: { key: (await import("@soulprint/proof")).nearPublicKey(w.dev.signer.publicKey), indices: [1], sig } });
    expect(bad.statusCode).toBe(401);
  });

  it("files: artist uploads final/source; returns final_file_hash", async () => {
    const w = await seeded();
    const data = await tinyImage(3);
    const url = `/pieces/${PIECE}/files`;
    expect((await call(w, w.client, "POST", url, { kind: "final", name: "f.png", data: b64.encode(data) })).statusCode).toBe(403);
    const r = await call(w, w.artist, "POST", url, { kind: "final", name: "f.png", data: b64.encode(data) });
    expect(r.statusCode).toBe(200);
    expect(r.json().sha256).toBe(b64.encode(sha256(data)));
  });

  it("story: artist writes, artist and owner read", async () => {
    const w = await seeded();
    const url = `/pieces/${PIECE}/story`;
    expect((await call(w, w.client, "POST", url, { text: "x" })).statusCode).toBe(403);
    expect((await call(w, w.artist, "POST", url, { text: "Started from a pencil sketch." })).statusCode).toBe(200);
    expect((await call(w, w.client, "GET", url)).json().story.text).toBe("Started from a pencil sketch.");
    expect((await call(w, w.stranger, "GET", url)).statusCode).toBe(403);
  });

  it("brief and messages: artist and owner only", async () => {
    const w = await seeded();
    for (const kind of ["brief", "messages"]) {
      const url = `/pieces/${PIECE}/${kind}`;
      expect((await call(w, w.client, "POST", url, { text: `${kind} from client` })).statusCode).toBe(200);
      expect((await call(w, w.artist, "POST", url, { text: `${kind} from artist` })).statusCode).toBe(200);
      expect((await call(w, w.stranger, "POST", url, { text: "spam" })).statusCode).toBe(403);
      const list = (await call(w, w.artist, "GET", url)).json().items;
      expect(list.map((m: any) => m.author)).toEqual([w.client.account, w.artist.account]);
      expect((await call(w, w.stranger, "GET", url)).statusCode).toBe(403);
    }
  });

  it("the commission conversation stays with artist and client after a resale (Plan 2 review I7)", async () => {
    const w = await seeded();
    for (const kind of ["brief", "messages"]) expect((await call(w, w.client, "POST", `/pieces/${PIECE}/${kind}`, { text: "private" })).statusCode).toBe(200);
    // Settled, then sold: the stranger is now the on-chain owner.
    Object.assign(w.chain.pieces.get(PIECE)!, { status: "Settled", owner: w.stranger.account });
    for (const kind of ["brief", "messages"]) {
      const url = `/pieces/${PIECE}/${kind}`;
      expect((await call(w, w.stranger, "GET", url)).statusCode).toBe(403);
      expect((await call(w, w.stranger, "POST", url, { text: "hi" })).statusCode).toBe(403);
      expect((await call(w, w.client, "GET", url)).statusCode).toBe(200);
    }
    // Client-only process frames stay with the client too.
    expect((await call(w, w.stranger, "GET", `/pieces/${PIECE}/progress?images=0`)).statusCode).toBe(403);
  });

  it("final anchor: artist forces the latest head on chain before deliver", async () => {
    const w = await seeded();
    const url = `/pieces/${PIECE}/anchor/final`;
    expect((await call(w, w.client, "POST", url, {})).statusCode).toBe(403);
    const r = await call(w, w.artist, "POST", url, {});
    expect(r.statusCode).toBe(200);
    expect(w.sender.anchors.at(-1)).toMatchObject({ pieceId: PIECE, count: 3, head: b64.encode(w.dev.frames[2]!.link) });
  });
});

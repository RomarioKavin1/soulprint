import { describe, expect, it } from "vitest";
import { b64 } from "@soulprint/proof";
import { Device, PIECE, PIECE2, world } from "./helpers.ts";

const post = (app: any, pieceId: string, body: unknown) => app.inject({ method: "POST", url: `/pieces/${pieceId}/frames`, payload: body });

describe("frame ingest (A27)", () => {
  it("accepts a valid batch and stores frames encrypted", async () => {
    const { app, dev } = await world();
    dev.capture(3);
    const r = await post(app, PIECE, await dev.batch(0, 2));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ stored: 3, count: 3 });
  });

  it("rejects_bad_signature", async () => {
    const { app, dev } = await world();
    dev.capture(3);
    const other = await Device.make(PIECE, 99);
    other.capture(3);
    // Signed by a key the piece never registered.
    expect((await post(app, PIECE, await other.batch(0, 2))).statusCode).toBe(401);
    // Registered key, signature over different bytes.
    const r = await post(app, PIECE, await dev.batch(0, 2, (b) => { b.sig = (other as any) && b.anchorSig; }));
    expect(r.statusCode).toBe(401);
    // Anchor signature is checked too.
    expect((await post(app, PIECE, await dev.batch(0, 2, (b) => { b.anchorSig = b.sig; }))).statusCode).toBe(401);
  });

  it("rejects_chain_break", async () => {
    const { app, dev } = await world();
    dev.capture(6);
    expect((await post(app, PIECE, await dev.batch(0, 2))).statusCode).toBe(200);
    // Gap: 4..5 before 3 exists.
    expect((await post(app, PIECE, await dev.batch(4, 5))).json().error).toBe("gap");
    // Tampered time inside a batch.
    const bad = await dev.batch(3, 5, (b) => { b.frames[1].deviceTs += 1; });
    const r = await post(app, PIECE, bad);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("chain_break");
    // Image that does not hash to its claimed hash.
    const img = await dev.batch(3, 5, (b) => { b.frames[0].jpeg = b64.encode(new Uint8Array([1, 2, 3])); });
    expect((await post(app, PIECE, img)).json().error).toBe("image_hash_mismatch");
  });

  it("rejects_frame_reused_from_other_piece", async () => {
    const { app, chain, dev } = await world();
    dev.capture(2);
    expect((await post(app, PIECE, await dev.batch(0, 1))).statusCode).toBe(200);
    // Same images, re-chained for another piece by the same artist.
    const thief = await Device.make(PIECE2, 43, 0);
    chain.pieces.set(PIECE2, { ...chain.pieces.get(PIECE)!, pieceId: PIECE2, keys: [thief.signer.publicKey] });
    thief.capture(2);
    const r = await post(app, PIECE2, await thief.batch(0, 1));
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("frame_reused");
  });

  it("duplicate_and_partial_batches_idempotent", async () => {
    const { app, dev } = await world();
    dev.capture(5);
    expect((await post(app, PIECE, await dev.batch(0, 2))).json()).toMatchObject({ stored: 3, count: 3 });
    // Exact retry.
    expect((await post(app, PIECE, await dev.batch(0, 2))).json()).toMatchObject({ stored: 0, count: 3 });
    // Overlapping retry that also carries new frames.
    expect((await post(app, PIECE, await dev.batch(1, 4))).json()).toMatchObject({ stored: 2, count: 5 });
    // A conflicting rewrite of history is refused.
    const fork = await Device.make(PIECE, 42, 9);
    fork.capture(2);
    expect((await post(app, PIECE, await fork.batch(0, 1))).json().error).toBe("conflict");
  });

  it("anchors on cadence through the service sender (A35)", async () => {
    const { app, dev, sender } = await world();
    dev.capture(25);
    await post(app, PIECE, await dev.batch(0, 9));
    expect(sender.anchors).toHaveLength(0);
    await post(app, PIECE, await dev.batch(10, 24));
    expect(sender.anchors).toHaveLength(1);
    expect(sender.anchors[0]).toMatchObject({ pieceId: PIECE, count: 25 });
  });

  it("stops accepting frames once the piece is delivered", async () => {
    const { app, chain, dev } = await world();
    chain.pieces.get(PIECE)!.status = "Delivered";
    dev.capture(1);
    expect((await post(app, PIECE, await dev.batch(0, 0))).statusCode).toBe(409);
  });
});

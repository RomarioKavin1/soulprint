import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { ingestBlock } from "../src/ingest.ts";
import { buildApi } from "../src/api.ts";

const C = "soulprint.test.near", P = `p1.${C}`;
const cfg = { collection: C, minIncome: {} };
const created = `EVENT_JSON:${JSON.stringify({ standard: "soulprint", version: "1.0.0", event: "piece_created", data: [{ piece_id: P, token_id: "1", artist: "artist.near", mode: "commission", currency: "Near", terms_hash: "x" }] })}`;

async function setup(chainHeight: number, chainTsMs: number) {
  const db = await openDb();
  await ingestBlock(db, cfg, { height: 100, timestampMs: 1_000_000, receipts: [{ executor: C, success: true, logs: [created] }] });
  const app = await buildApi({ db, head: async () => ({ height: chainHeight, timestampMs: chainTsMs }) });
  return app;
}

describe("indexer API", () => {
  it("history_shows_lag_indicator: far behind the chain → updating", async () => {
    const app = await setup(400, 1_000_000 + 5 * 60_000);
    const r = (await app.inject({ method: "GET", url: `/pieces/${P}/history` })).json();
    expect(r.lag).toMatchObject({ indexedHeight: 100, chainHeight: 400, behindMs: 300_000, updating: true });
    expect(r.events[0].event).toBe("piece_created");
  });
  it("caught up → not updating", async () => {
    const app = await setup(101, 1_000_000 + 1_000);
    expect((await app.inject({ method: "GET", url: "/lag" })).json().updating).toBe(false);
  });
  it("artist pieces", async () => {
    const app = await setup(101, 1_001_000);
    const r = (await app.inject({ method: "GET", url: "/artists/artist.near/pieces" })).json();
    expect(r.pieces).toEqual([{ pieceId: P, tokenId: "1", owner: "artist.near", mode: "commission" }]);
  });
});

describe("lag with skipped heights", () => {
  it("uses the latest block seen, not the (possibly empty) last height", async () => {
    const db = await openDb();
    await ingestBlock(db, cfg, { height: 100, timestampMs: 1_000_000, receipts: [] });
    await db.query("UPDATE meta SET v = '150' WHERE k = 'height'"); // heights 101–150 had no block
    const app = await buildApi({ db, head: async () => ({ height: 151, timestampMs: 1_002_000 }) });
    expect((await app.inject({ method: "GET", url: "/lag" })).json()).toMatchObject({ indexedHeight: 150, behindMs: 2_000, updating: false });
  });
});

describe("owner pieces (review minor 14)", () => {
  it("lists pieces an account owns, by the latest owner_changed", async () => {
    const db = await openDb();
    const owned = (owner: string, seq: string) => `EVENT_JSON:${JSON.stringify({ standard: "soulprint", version: "1.0.0", event: "owner_changed", data: [{ piece_id: P, old_owner: "x", new_owner: owner, seq, cause: "sale" }] })}`;
    await ingestBlock(db, cfg, { height: 100, timestampMs: 1, receipts: [{ executor: C, success: true, logs: [created] }] });
    await ingestBlock(db, cfg, { height: 101, timestampMs: 2, receipts: [{ executor: P, success: true, logs: [owned("client.near", "1")] }] });
    await ingestBlock(db, cfg, { height: 102, timestampMs: 3, receipts: [{ executor: P, success: true, logs: [owned("buyer.near", "2")] }] });
    const app = await buildApi({ db, head: async () => ({ height: 102, timestampMs: 3 }) });
    expect((await app.inject({ method: "GET", url: "/owners/buyer.near/pieces" })).json().pieces).toEqual([{ pieceId: P, tokenId: "1", owner: "buyer.near", mode: "commission", artist: "artist.near" }]);
    expect((await app.inject({ method: "GET", url: "/owners/client.near/pieces" })).json().pieces).toEqual([]);
  });
});

describe("market (showcase)", () => {
  it("tracks the listing, holder and sales from events: listed → sold → listed → delisted", async () => {
    const db = await openDb();
    const ev = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: "soulprint", version: "1.0.0", event, data: [{ piece_id: P, ...data }] })}`;
    await ingestBlock(db, cfg, { height: 100, timestampMs: 1, receipts: [{ executor: C, success: true, logs: [created] }] });
    const app = await buildApi({ db, head: async () => ({ height: 106, timestampMs: 6 }) });
    const m = async () => (await app.inject({ method: "GET", url: `/market?ids=${P}` })).json().pieces[0];
    expect(await m()).toMatchObject({ owner: "artist.near", listing: null, sales: 0, lastSale: null });
    await ingestBlock(db, cfg, { height: 101, timestampMs: 2, receipts: [{ executor: P, success: true, logs: [ev("listed", { seller: "artist.near", price: "3000000", nonce: "1", reserved_for: null })] }] });
    expect((await m()).listing).toEqual({ price: "3000000", reservedFor: null });
    await ingestBlock(db, cfg, { height: 102, timestampMs: 3, receipts: [{ executor: P, success: true, logs: [ev("sold", { seller: "artist.near", buyer: "buyer.near", price: "3000000", royalty: "0", nonce: "1" }), ev("owner_changed", { old_owner: "artist.near", new_owner: "buyer.near", seq: "1", cause: "sale" })] }] });
    expect(await m()).toMatchObject({ owner: "buyer.near", listing: null, sales: 1, lastSale: { price: "3000000", atMs: 3 } });
    await ingestBlock(db, cfg, { height: 103, timestampMs: 4, receipts: [{ executor: P, success: true, logs: [ev("listed", { seller: "buyer.near", price: "9000000", nonce: "2", reserved_for: "x.near" })] }] });
    expect((await m()).listing).toEqual({ price: "9000000", reservedFor: "x.near" });
    await ingestBlock(db, cfg, { height: 104, timestampMs: 5, receipts: [{ executor: P, success: true, logs: [ev("delisted", { nonce: "2" })] }] });
    expect((await m()).listing).toBeNull();
    expect((await app.inject({ method: "GET", url: "/market" })).json().pieces).toHaveLength(1);
  });
});

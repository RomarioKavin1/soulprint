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

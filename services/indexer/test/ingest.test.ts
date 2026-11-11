import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { ingestBlock, type Block } from "../src/ingest.ts";
import { history } from "../src/history.ts";

const C = "soulprint.test.near";
const P = `p1.${C}`;
const cfg = { collection: C, minIncome: { "usdc.test.near": 10_000n, Near: 10n ** 21n } as Record<string, bigint> };
const ev = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: "soulprint", version: "1.0.0", event, data: [{ piece_id: P, ...data }] })}`;
let h = 100;
const block = (receipts: Block["receipts"]): Block => ({ height: h++, timestampMs: 1_800_000_000_000 + h * 1000, receipts });
const ok = (logs: string[], executor = P) => ({ executor, success: true, logs });

async function fresh() {
  const db = await openDb();
  await ingestBlock(db, cfg, block([ok([`EVENT_JSON:${JSON.stringify({ standard: "soulprint", version: "1.0.0", event: "piece_created", data: [{ piece_id: P, token_id: "1", artist: "artist.near", mode: "commission", currency: { Ft: "usdc.test.near" }, terms_hash: "x" }] })}`], C)]));
  return db;
}

describe("indexer ingest", () => {
  it("rejects_events_from_foreign_accounts (and failed receipts, and other standards)", async () => {
    const db = await fresh();
    await ingestBlock(db, cfg, block([
      ok([ev("income", { payer: "x", amount: "50000" })], `p1.evil.near`),
      ok([ev("income", { payer: "x", amount: "50000" })], `p1.${C}.evil.near`),
      ok([ev("income", { payer: "x", amount: "50000" })], `soulprint.test.near.fake`),
      { executor: P, success: false, logs: [ev("income", { payer: "x", amount: "50000" })] },
      ok([`EVENT_JSON:${JSON.stringify({ standard: "nep171", version: "1.0.0", event: "nft_mint", data: [{}] })}`], P),
      ok([ev("income", { payer: "shop.near", amount: "50000" })], P),
    ]));
    const r = await history(db, P);
    expect(r.events.map((e) => e.event)).toEqual(["piece_created", "income"]);
    expect(r.balances.holderPool).toBe("50000");
  });

  it("ignores_dust_income (below the currency's minimum)", async () => {
    const db = await fresh();
    await ingestBlock(db, cfg, block([ok([ev("income", { payer: "spam.near", amount: "9999" }), ev("income", { payer: "shop.near", amount: "10000" })])]));
    const r = await history(db, P);
    expect(r.events.filter((e) => e.event === "income")).toHaveLength(1);
    expect(r.balances.holderPool).toBe("10000");
  });

  it("history_reconstructs_balances_from_events", async () => {
    const db = await fresh();
    const steps: [string, object][] = [
      ["funded", { payer: "client.near", owner: "client.near", amount: "100000000", terms_hash: "x" }],
      ["milestone_released", { index: 0, amount: "30000000" }],
      ["delivered", { final_file_hash: "f", report_hash: "r" }],
      ["settled", { artist_amount: "70000000" }],
      ["owner_changed", { old_owner: "artist.near", new_owner: "client.near", seq: "1", cause: "settle" }],
      ["income", { payer: "shop.near", amount: "2000000" }],
      ["listed", { seller: "client.near", price: "40000000", nonce: "1", reserved_for: null }],
      ["income", { payer: "shop.near", amount: "1000000" }],
      ["sold", { seller: "client.near", buyer: "buyer.near", price: "40000000", royalty: "2000000", nonce: "1" }],
      ["owner_changed", { old_owner: "client.near", new_owner: "buyer.near", seq: "2", cause: "sale" }],
      ["withdraw", { owner: "buyer.near", amount: "3000000" }],
      ["claim", { creditor: "artist.near", recipient: "artist.near", amount: "102000000" }],
    ];
    for (const [e, d] of steps) await ingestBlock(db, cfg, block([ok([ev(e, d)])]));
    const r = await history(db, P);
    expect(r.balances).toEqual({
      funded: "100000000", escrow: "0", released: "100000000", refunded: "0", holderPool: "0",
      credits: { "artist.near": "0", "client.near": "38000000", "buyer.near": "3000000" },
      owner: "buyer.near", status: "Settled",
    });
    expect(r.events).toHaveLength(steps.length + 1);
  });

  it("is idempotent per block (re-ingesting a block changes nothing)", async () => {
    const db = await fresh();
    const b = block([ok([ev("income", { payer: "shop.near", amount: "50000" })])]);
    await ingestBlock(db, cfg, b);
    await ingestBlock(db, cfg, b);
    expect((await history(db, P)).balances.holderPool).toBe("50000");
  });
});

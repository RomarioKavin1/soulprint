import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { history } from "../src/history.ts";
import { syncOnce, type TxApi, type TxRecord, type TxReceipt } from "../src/txapi.ts";

const C = "soulprint.testnet";
const P = `p1.${C}`, P2 = `p2.${C}`;
const cfg = { collection: C, minIncome: {} as Record<string, bigint> };
const ev = (event: string, data: object, piece = P) =>
  `EVENT_JSON:${JSON.stringify({ standard: "soulprint", version: "1.0.0", event, data: [{ piece_id: piece, ...data }] })}`;
const created = (piece: string, token: string) => ev("piece_created", { token_id: token, artist: "artist.testnet", mode: "commission", currency: { Ft: "usdc.testnet" }, terms_hash: "x" }, piece);
let rid = 0;
const rc = (height: number, executor: string, logs: string[], index = 0): TxReceipt =>
  ({ id: `r${rid++}`, height, timestampMs: 1_800_000_000_000 + height * 1000, index, executor, success: true, logs });

/** A fake tx API: transactions, and which accounts each one touched. */
class FakeApi implements TxApi {
  txsByHash = new Map<string, TxRecord>();
  touched = new Map<string, Set<string>>();
  add(hash: string, accounts: string[], receipts: TxReceipt[]) {
    this.txsByHash.set(hash, { hash, height: receipts[0]!.height, receipts });
    for (const a of accounts) (this.touched.get(a) ?? this.touched.set(a, new Set()).get(a)!).add(hash);
  }
  async accountTxs(a: string) {
    return [...(this.touched.get(a) ?? [])].map((h) => ({ hash: h, height: this.txsByHash.get(h)!.height }));
  }
  async txs(hs: string[]) {
    return hs.map((h) => structuredClone(this.txsByHash.get(h)!));
  }
}
const head = (height: number) => ({ height, timestampMs: 1_800_000_000_000 + height * 1000 });

describe("transaction-API source", () => {
  it("a piece created this cycle is polled this cycle (its funding is not missed)", async () => {
    const db = await openDb(), api = new FakeApi();
    api.add("t1", [C, P], [rc(100, C, [created(P, "1")])]);
    api.add("t2", [P, "usdc.testnet"], [rc(110, "usdc.testnet", []), rc(111, P, [ev("funded", { amount: "5", owner: "client.testnet" })])]);
    await syncOnce(db, cfg, api, head(200));
    const h = await history(db, P);
    expect(h.events.map((e) => e.event)).toEqual(["piece_created", "funded"]);
    expect(h.balances).toMatchObject({ funded: "5", escrow: "5", owner: "client.testnet" });
  });

  it("a transaction found late at an already-indexed height is appended, not dropped", async () => {
    const db = await openDb(), api = new FakeApi();
    api.add("t1", [C], [rc(100, C, [created(P, "1")]), rc(101, C, [created(P2, "2")])]);
    api.add("t2", [P], [rc(120, P, [ev("funded", { amount: "5", owner: "client.testnet" })])]);
    await syncOnce(db, cfg, api, head(200));
    // Another piece's transaction at the same height 120 shows up only in the next cycle.
    api.add("t3", [P2], [rc(120, P2, [ev("funded", { amount: "7", owner: "client.testnet" }, P2)], 5)]);
    await syncOnce(db, cfg, api, head(210));
    expect((await history(db, P)).balances.funded).toBe("5");
    expect((await history(db, P2)).balances.funded).toBe("7");
  });

  it("a transaction touching several of our accounts is ingested once", async () => {
    const db = await openDb(), api = new FakeApi();
    api.add("t1", [C, P], [rc(100, C, [created(P, "1")])]);
    api.add("t2", [P, C], [rc(110, P, [ev("funded", { amount: "5", owner: "c.testnet" })]), rc(111, C, [])]);
    await syncOnce(db, cfg, api, head(200));
    await syncOnce(db, cfg, api, head(201)); // t2 is done now (> 30 blocks), and was seen twice before
    expect((await history(db, P)).events.filter((e) => e.event === "funded")).toHaveLength(1);
  });

  it("a callback that lands after the first read is picked up while the transaction is recent", async () => {
    const db = await openDb(), api = new FakeApi();
    api.add("t1", [C, P], [rc(100, C, [created(P, "1")])]);
    const claim = [rc(150, P, [ev("claim", { creditor: "artist.testnet", recipient: "artist.testnet", amount: "5" })])];
    api.add("t2", [P], claim);
    await syncOnce(db, cfg, api, head(152));
    claim.push(rc(154, P, [ev("claim_restored", { creditor: "artist.testnet", amount: "5" })]));
    await syncOnce(db, cfg, api, head(160));
    expect((await history(db, P)).events.map((e) => e.event)).toEqual(["piece_created", "claim", "claim_restored"]);
  });

  it("indexed height is the head of the last complete cycle", async () => {
    const db = await openDb(), api = new FakeApi();
    await syncOnce(db, cfg, api, head(300));
    expect((await db.query<{ v: string }>("SELECT v FROM meta WHERE k = 'height'")).rows[0]!.v).toBe("300");
  });
});

describe("transaction-API source under a rate limit (found at 83 testnet pieces)", () => {
  const many = async (n: number) => {
    const db = await openDb(), api = new FakeApi();
    for (let i = 1; i <= n; i++) api.add(`c${i}`, [C], [rc(100 + i, C, [created(`p${i}.${C}`, String(i))])]);
    return { db, api };
  };
  it("idle pieces are read a slice per cycle; indexed height is the oldest read", async () => {
    const { db, api } = await many(10);
    const reads: string[] = [];
    const orig = api.accountTxs.bind(api);
    api.accountTxs = async (a: string) => (reads.push(a), orig(a));
    await syncOnce(db, cfg, api, head(500), { idlePerCycle: 3, hotBlocks: 0 });
    // Collection, then the 10 pieces it created (created this cycle → read this cycle).
    expect(reads.length).toBe(11);
    reads.length = 0;
    await syncOnce(db, cfg, api, head(510), { idlePerCycle: 3, hotBlocks: 0 });
    expect(reads.length).toBe(4); // collection + 3 idle
    const meta = Number((await db.query<{ v: string }>("SELECT v FROM meta WHERE k = 'height'")).rows[0]!.v);
    expect(meta).toBe(500); // 7 pieces were last read at 500
  });
  it("one rate-limited account does not stop the cycle; it is read first next time", async () => {
    const { db, api } = await many(3);
    await syncOnce(db, cfg, api, head(500));
    api.add("f1", [`p2.${C}`], [rc(600, `p2.${C}`, [ev("funded", { amount: "9", owner: "c.testnet" }, `p2.${C}`)])]);
    const orig = api.accountTxs.bind(api);
    let limited = true;
    api.accountTxs = async (a: string) => {
      if (a === `p2.${C}` && limited) throw new Error("/v0/account 429: rate limited");
      return orig(a);
    };
    const r = await syncOnce(db, cfg, api, head(700), { idlePerCycle: 5, hotBlocks: 0 });
    expect(r.failed).toBeGreaterThan(0);
    limited = false;
    await syncOnce(db, cfg, api, head(710), { idlePerCycle: 1, hotBlocks: 0 });
    expect((await history(db, `p2.${C}`)).balances.funded).toBe("9");
  });
});

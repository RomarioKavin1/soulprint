/**
 * Transaction-API source for public networks. Scanning every block does not work on testnet:
 * neardata's free tier serves 30 blocks a minute while testnet makes ~60, and RPC scanning means
 * one call per shard (10) per block. Instead: list the transactions that touched the collection
 * and each piece account (FastNear tx API), fetch only those, and ingest their receipts by height.
 *
 * - Pieces created in a cycle are polled in the same cycle (found from `piece_created`).
 * - Receipts are de-duplicated by id (a transaction touches several of our accounts) and a late
 *   discovery is appended at its height (see ingest.ts).
 * - A transaction is "done" once its block is `completeAfterBlocks` behind the head (its callbacks
 *   have run); until then it is re-read each cycle so later receipts are picked up.
 * - Indexed height = the chain head at the start of the last complete cycle.
 * Limits: one call per watched account per cycle (fine for hundreds of pieces, not millions); a
 * transaction to a piece made by any client is found, because the API indexes by receipt.
 */
import type { Db } from "./db.ts";
import { ingestBlock, type IngestConfig, type Receipt } from "./ingest.ts";

export interface TxReceipt extends Receipt { id: string; height: number; timestampMs: number; index: number }
export interface TxRecord { hash: string; height: number; receipts: TxReceipt[] }
export interface TxApi {
  /** Hashes and block heights of transactions that touched `account`, any role. */
  accountTxs(account: string): Promise<{ hash: string; height: number }[]>;
  txs(hashes: string[]): Promise<TxRecord[]>;
}

const okStatus = (s: any) => s && typeof s === "object" && ("SuccessValue" in s || "SuccessReceiptId" in s);

export class FastnearTxApi implements TxApi {
  constructor(private base: string, private onWarn: (m: string) => void = () => {}) {}
  private async post(path: string, body: unknown): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${this.base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 429 && attempt < 5) {
        await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
        continue;
      }
      if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    }
  }
  async accountTxs(account: string) {
    const j = await this.post("/v0/account", { account_id: account });
    const list = (j.account_txs ?? []) as any[];
    if (typeof j.txs_count === "number" && j.txs_count > list.length)
      this.onWarn(`${account}: API returned ${list.length} of ${j.txs_count} transactions (older ones not paged)`);
    return list.map((t) => ({ hash: t.transaction_hash as string, height: Number(t.tx_block_height) }));
  }
  async txs(hashes: string[]) {
    const out: TxRecord[] = [];
    for (let i = 0; i < hashes.length; i += 20) {
      const j = await this.post("/v0/transactions", { tx_hashes: hashes.slice(i, i + 20) });
      for (const t of j.transactions ?? []) {
        if (!t) continue;
        out.push({
          hash: t.transaction.hash,
          height: Number(t.execution_outcome.block_height),
          receipts: (t.receipts ?? []).map((r: any) => {
            const e = r.execution_outcome;
            return {
              id: e.id, height: Number(e.block_height), timestampMs: Math.floor(Number(e.block_timestamp) / 1e6), index: Number(e.index ?? 0),
              executor: e.outcome.executor_id, success: okStatus(e.outcome.status), logs: e.outcome.logs ?? [],
            };
          }),
        });
      }
    }
    return out;
  }
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await f(items[i++]!);
  }));
}

export async function syncOnce(
  db: Db, cfg: IngestConfig, api: TxApi, head: { height: number; timestampMs: number },
  opts: { completeAfterBlocks?: number; concurrency?: number } = {},
) {
  const completeAfter = opts.completeAfterBlocks ?? 30;
  const polled = new Set<string>();
  let ingested = 0;
  for (;;) {
    const pieces = (await db.query<{ piece_id: string }>("SELECT piece_id FROM pieces")).rows.map((r) => r.piece_id);
    const todo = [cfg.collection, ...pieces].filter((a) => !polled.has(a));
    if (!todo.length) break;
    const found = new Map<string, number>();
    await pool(todo, opts.concurrency ?? 4, async (a) => {
      polled.add(a);
      for (const t of await api.accountTxs(a)) if (t.height <= head.height) found.set(t.hash, t.height);
    });
    const done = new Set((await db.query<{ hash: string }>("SELECT hash FROM txs_done WHERE hash = ANY($1)", [[...found.keys()]])).rows.map((r) => r.hash));
    const fresh = [...found.keys()].filter((h) => !done.has(h));
    const recs = fresh.length ? await api.txs(fresh) : [];
    const byHeight = new Map<number, TxReceipt[]>();
    for (const t of recs) for (const r of t.receipts) if (r.height <= head.height) (byHeight.get(r.height) ?? byHeight.set(r.height, []).get(r.height)!).push(r);
    for (const h of [...byHeight.keys()].sort((a, b) => a - b)) {
      const rs = byHeight.get(h)!.sort((a, b) => a.index - b.index);
      await ingestBlock(db, cfg, { height: h, timestampMs: rs[0]!.timestampMs, receipts: rs });
      ingested += rs.length;
    }
    for (const t of recs) if (t.height <= head.height - completeAfter) await db.query("INSERT INTO txs_done (hash) VALUES ($1) ON CONFLICT DO NOTHING", [t.hash]);
  }
  await db.query("INSERT INTO blocks (height, ts_ms) VALUES ($1, $2) ON CONFLICT DO NOTHING", [head.height, head.timestampMs]);
  await db.query("INSERT INTO meta (k, v) VALUES ('height', $1) ON CONFLICT (k) DO UPDATE SET v = GREATEST(meta.v::bigint, EXCLUDED.v::bigint)::text", [String(head.height)]);
  return { accounts: polled.size, receipts: ingested };
}

export function followTxApi(
  db: Db, cfg: IngestConfig, api: TxApi, head: () => Promise<{ height: number; timestampMs: number }>,
  onError: (e: unknown) => void, intervalMs = 3000,
) {
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        await syncOnce(db, cfg, api, await head());
      } catch (e) {
        onError(e);
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
  })();
  return () => {
    stopped = true;
  };
}

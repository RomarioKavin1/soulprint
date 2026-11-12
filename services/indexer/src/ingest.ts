/**
 * Block ingest (Plan 3 Task 6, A48, A55): only successful receipts executed by the collection or
 * by an account `p<N>.<collection>`; only `soulprint` events; income below the currency's minimum
 * is dropped. Idempotent per (height, position); receipts that carry an `id` (transaction-API
 * source) are instead de-duplicated by id and appended after what that height already holds, so
 * a transaction discovered late never collides with one ingested earlier at the same height.
 */
import type { Db } from "./db.ts";

export interface Receipt { executor: string; success: boolean; logs: string[]; id?: string }
export interface Block { height: number; timestampMs: number; receipts: Receipt[] }
export interface IngestConfig { collection: string; minIncome: Record<string, bigint> }

export function isOurs(executor: string, collection: string) {
  if (executor === collection) return true;
  const suffix = "." + collection;
  return executor.endsWith(suffix) && /^p[0-9]+$/.test(executor.slice(0, -suffix.length));
}

function currencyKey(c: unknown): string {
  return c === "Near" ? "Near" : String((c as { Ft?: string })?.Ft ?? "");
}

export async function ingestBlock(db: Db, cfg: IngestConfig, b: Block) {
  const append = b.receipts.some((r) => r.id);
  let idx = append
    ? Number((await db.query<{ n: number | null }>("SELECT max(idx) + 1 AS n FROM events WHERE height = $1", [b.height])).rows[0]?.n ?? 0)
    : 0;
  await db.query("INSERT INTO blocks (height, ts_ms) VALUES ($1, $2) ON CONFLICT DO NOTHING", [b.height, b.timestampMs]);
  for (const r of b.receipts) {
    if (!r.success || !isOurs(r.executor, cfg.collection)) continue;
    if (r.id && (await db.query("INSERT INTO seen_receipts (rid) VALUES ($1) ON CONFLICT DO NOTHING", [r.id])).affectedRows !== 1) continue;
    for (const log of r.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      let e: any;
      try {
        e = JSON.parse(log.slice("EVENT_JSON:".length));
      } catch {
        continue;
      }
      if (e?.standard !== "soulprint" || !Array.isArray(e.data)) continue;
      for (const data of e.data) {
        const pieceId: string = data?.piece_id ?? "";
        // Piece events must come from that piece's own account; collection events from the collection.
        if (pieceId && e.event !== "piece_created" && pieceId !== r.executor) continue;
        if (e.event === "piece_created") {
          if (r.executor !== cfg.collection) continue;
          await db.query(
            "INSERT INTO pieces (piece_id, token_id, artist, mode, currency, created_height) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
            [pieceId, String(data.token_id), data.artist, data.mode, JSON.stringify(data.currency), b.height],
          );
          await db.query("INSERT INTO holders (piece_id, owner, seq) VALUES ($1,$2,0) ON CONFLICT DO NOTHING", [pieceId, data.artist]);
        }
        if (e.event === "income") {
          const p = (await db.query<{ currency: unknown }>("SELECT currency FROM pieces WHERE piece_id = $1", [pieceId])).rows[0];
          const min = p ? cfg.minIncome[currencyKey(p.currency)] : undefined;
          if (min !== undefined && BigInt(data.amount) < min) continue;
        }
        if (e.event === "owner_changed")
          await db.query(
            "INSERT INTO holders (piece_id, owner, seq) VALUES ($1,$2,$3) ON CONFLICT (piece_id) DO UPDATE SET owner = EXCLUDED.owner, seq = EXCLUDED.seq WHERE holders.seq < EXCLUDED.seq",
            [pieceId, data.new_owner, Number(data.seq)],
          );
        if (e.event === "funded")
          await db.query("UPDATE holders SET owner = $2 WHERE piece_id = $1 AND seq = 0", [pieceId, data.owner]);
        await db.query("INSERT INTO events (height, idx, piece_id, event, data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [
          b.height, idx++, pieceId, e.event, JSON.stringify(data),
        ]);
      }
    }
  }
  await db.query("INSERT INTO meta (k, v) VALUES ('height', $1) ON CONFLICT (k) DO UPDATE SET v = GREATEST(meta.v::bigint, EXCLUDED.v::bigint)::text", [String(b.height)]);
}

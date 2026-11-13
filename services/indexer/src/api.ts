/** Read API: history (with balances), an artist's pieces, and how far behind the chain we are. */
import Fastify from "fastify";
import type { Db } from "./db.ts";
import { history } from "./history.ts";
import { market } from "./market.ts";

/** History labels itself "updating" past this (Review Focus 4). */
export const LAG_UPDATING_MS = 30_000;

export interface ApiDeps { db: Db; head: () => Promise<{ height: number; timestampMs: number }> }

export async function buildApi(d: ApiDeps) {
  const app = Fastify();
  app.addHook("onSend", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
  });

  /** Global lag, or (transaction-API source) how fresh one piece is: its own last read. */
  async function lag(pieceId?: string) {
    const meta = (await d.db.query<{ v: string }>("SELECT v FROM meta WHERE k = 'height'")).rows[0];
    const own = pieceId
      ? (await d.db.query<{ h: string }>("SELECT polled_head AS h FROM account_poll WHERE account = $1 AND polled_head > 0", [pieceId])).rows[0]
      : undefined;
    const indexedHeight = own ? Number(own.h) : meta ? Number(meta.v) : 0;
    // Heights without a block (skipped) have no row: use the latest block actually seen.
    const ts = Number((await d.db.query<{ ts: string | null }>("SELECT max(ts_ms) AS ts FROM blocks WHERE height <= $1", [indexedHeight])).rows[0]?.ts ?? 0);
    const head = await d.head();
    const behindMs = Math.max(0, head.timestampMs - ts);
    return { indexedHeight, chainHeight: head.height, behindBlocks: Math.max(0, head.height - indexedHeight), behindMs, updating: behindMs > LAG_UPDATING_MS };
  }

  app.get("/lag", () => lag());
  app.get<{ Params: { id: string } }>("/pieces/:id/history", async (req) => {
    // Someone is looking: the transaction-API source reads this piece every cycle for a while.
    await d.db.query("UPDATE account_poll SET wanted_ms = $2 WHERE account = $1", [req.params.id, Date.now()]);
    return { ...(await history(d.db, req.params.id)), lag: await lag(req.params.id) };
  });
  app.get<{ Params: { id: string } }>("/artists/:id/pieces", async (req) => {
    const rows = (await d.db.query<any>(
      "SELECT p.piece_id, p.token_id, p.mode, h.owner FROM pieces p LEFT JOIN holders h USING (piece_id) WHERE p.artist = $1 ORDER BY p.created_height DESC", [req.params.id],
    )).rows;
    return { pieces: rows.map((r) => ({ pieceId: r.piece_id, tokenId: r.token_id, owner: r.owner, mode: r.mode })), lag: await lag() };
  });
  app.get<{ Params: { id: string } }>("/owners/:id/pieces", async (req) => {
    const rows = (await d.db.query<any>(
      "SELECT p.piece_id, p.token_id, p.mode, p.artist, h.owner FROM holders h JOIN pieces p USING (piece_id) WHERE h.owner = $1 ORDER BY p.created_height DESC", [req.params.id],
    )).rows;
    return { pieces: rows.map((r) => ({ pieceId: r.piece_id, tokenId: r.token_id, owner: r.owner, mode: r.mode, artist: r.artist })), lag: await lag() };
  });
  /** Listings, holders and sales for the showcase; `ids` (comma-separated) narrows it. */
  app.get<{ Querystring: { ids?: string } }>("/market", async (req) => {
    const ids = req.query.ids ? String(req.query.ids).split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500) : undefined;
    return { pieces: await market(d.db, ids), lag: await lag() };
  });
  app.get("/health", async () => ({ ok: true }));
  return app;
}

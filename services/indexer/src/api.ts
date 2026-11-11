/** Read API: history (with balances), an artist's pieces, and how far behind the chain we are. */
import Fastify from "fastify";
import type { Db } from "./db.ts";
import { history } from "./history.ts";

/** History labels itself "updating" past this (Review Focus 4). */
export const LAG_UPDATING_MS = 30_000;

export interface ApiDeps { db: Db; head: () => Promise<{ height: number; timestampMs: number }> }

export async function buildApi(d: ApiDeps) {
  const app = Fastify();
  app.addHook("onSend", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
  });

  async function lag() {
    const meta = (await d.db.query<{ v: string }>("SELECT v FROM meta WHERE k = 'height'")).rows[0];
    const indexedHeight = meta ? Number(meta.v) : 0;
    // Heights without a block (skipped) have no row: use the latest block actually seen.
    const ts = Number((await d.db.query<{ ts: string | null }>("SELECT max(ts_ms) AS ts FROM blocks WHERE height <= $1", [indexedHeight])).rows[0]?.ts ?? 0);
    const head = await d.head();
    const behindMs = Math.max(0, head.timestampMs - ts);
    return { indexedHeight, chainHeight: head.height, behindBlocks: Math.max(0, head.height - indexedHeight), behindMs, updating: behindMs > LAG_UPDATING_MS };
  }

  app.get("/lag", lag);
  app.get<{ Params: { id: string } }>("/pieces/:id/history", async (req) => ({ ...(await history(d.db, req.params.id)), lag: await lag() }));
  app.get<{ Params: { id: string } }>("/artists/:id/pieces", async (req) => {
    const rows = (await d.db.query<any>(
      "SELECT p.piece_id, p.token_id, p.mode, h.owner FROM pieces p LEFT JOIN holders h USING (piece_id) WHERE p.artist = $1 ORDER BY p.created_height DESC", [req.params.id],
    )).rows;
    return { pieces: rows.map((r) => ({ pieceId: r.piece_id, tokenId: r.token_id, owner: r.owner, mode: r.mode })), lag: await lag() };
  });
  app.get("/health", async () => ({ ok: true }));
  return app;
}

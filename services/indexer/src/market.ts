/**
 * The market view of pieces (showcase, 13 Nov): who holds each piece, whether it is offered and at
 * what price, how often it has sold. Rebuilt from the events in order; the piece account stays
 * the truth (the showcase links to it, and a buy is pinned to the listing read from the chain).
 */
import type { Db } from "./db.ts";

export interface MarketRow {
  pieceId: string;
  artist: string;
  currency: unknown;
  owner: string | null;
  listing: { price: string; reservedFor: string | null } | null;
  sales: number;
  lastSale: { price: string; atMs: number } | null;
}

export async function market(db: Db, ids?: string[]): Promise<MarketRow[]> {
  const pieces = (await db.query<any>(
    ids?.length ? "SELECT piece_id, artist, currency FROM pieces WHERE piece_id = ANY($1::text[])" : "SELECT piece_id, artist, currency FROM pieces ORDER BY created_height DESC LIMIT 1000",
    ids?.length ? [ids] : [],
  )).rows;
  if (!pieces.length) return [];
  const rows = new Map<string, MarketRow>(pieces.map((p) => [p.piece_id, { pieceId: p.piece_id, artist: p.artist, currency: p.currency, owner: p.artist, listing: null, sales: 0, lastSale: null }]));
  const events = (await db.query<any>(
    `SELECT e.piece_id, e.event, e.data, b.ts_ms FROM events e JOIN blocks b USING (height)
     WHERE e.piece_id = ANY($1::text[]) AND e.event IN ('listed', 'delisted', 'sold', 'owner_changed') ORDER BY e.height, e.idx`,
    [[...rows.keys()]],
  )).rows;
  for (const e of events) {
    const r = rows.get(e.piece_id)!;
    const d = e.data;
    if (e.event === "listed") r.listing = { price: String(d.price), reservedFor: d.reserved_for ?? null };
    else if (e.event === "delisted") r.listing = null;
    else if (e.event === "sold") { r.listing = null; r.sales++; r.lastSale = { price: String(d.price), atMs: Number(e.ts_ms) }; }
    else if (e.event === "owner_changed") { r.owner = d.new_owner; r.listing = null; }
  }
  return [...rows.values()];
}

/** A piece's history and the balances its events imply (mirrors the piece's accounting). */
import type { Db } from "./db.ts";

export interface Balances {
  funded: string; escrow: string; released: string; refunded: string; holderPool: string;
  credits: Record<string, string>; owner: string | null; status: string;
}

export async function history(db: Db, pieceId: string) {
  const rows = (await db.query<any>(
    "SELECT e.height, e.idx, e.event, e.data, b.ts_ms FROM events e JOIN blocks b USING (height) WHERE piece_id = $1 ORDER BY e.height, e.idx", [pieceId],
  )).rows;
  let funded = 0n, escrow = 0n, released = 0n, refunded = 0n, pool = 0n;
  const credits = new Map<string, bigint>();
  let artist: string | null = null, owner: string | null = null, status = "Offered";
  const add = (who: string, v: bigint) => credits.set(who, (credits.get(who) ?? 0n) + v);
  for (const r of rows) {
    const d = r.data;
    switch (r.event) {
      case "piece_created": artist = d.artist; owner = d.artist; break;
      case "funded": funded += BigInt(d.amount); escrow += BigInt(d.amount); owner = d.owner; status = "InProgress"; break;
      case "milestone_released": escrow -= BigInt(d.amount); released += BigInt(d.amount); add(artist!, BigInt(d.amount)); break;
      case "delivered": status = "Delivered"; break;
      case "changes_requested": status = "InProgress"; break;
      case "rejected": status = "Disputed"; break;
      case "settled": escrow -= BigInt(d.artist_amount); released += BigInt(d.artist_amount); add(artist!, BigInt(d.artist_amount)); status = "Settled"; break;
      case "refunded": escrow -= BigInt(d.amount); refunded += BigInt(d.amount); add(d.to, BigInt(d.amount)); status = "Refunded"; break;
      case "cancelled": status = "Cancelled"; break;
      case "resolved": {
        const a = BigInt(d.artist_amount), o = BigInt(d.owner_amount);
        escrow -= a + o; released += a; refunded += o;
        add(artist!, a);
        if (owner) add(owner, o);
        status = d.outcome === "refunded" ? "Refunded" : "Settled";
        break;
      }
      case "bond_paid": add(d.to, BigInt(d.amount)); break;
      case "income": pool += BigInt(d.amount); break;
      case "withdraw": pool -= BigInt(d.amount); add(d.owner, BigInt(d.amount)); break;
      case "sold": add(d.seller, BigInt(d.price) - BigInt(d.royalty)); add(artist!, BigInt(d.royalty)); break;
      case "owner_changed": owner = d.new_owner; break;
      case "claim": add(d.creditor, -BigInt(d.amount)); break;
      case "claim_restored": add(d.creditor, BigInt(d.amount)); break;
    }
  }
  const balances: Balances = {
    funded: funded.toString(), escrow: escrow.toString(), released: released.toString(), refunded: refunded.toString(),
    holderPool: pool.toString(), credits: Object.fromEntries([...credits].map(([k, v]) => [k, v.toString()])), owner, status,
  };
  return { events: rows.map((r) => ({ height: Number(r.height), at: Number(r.ts_ms), event: r.event as string, data: r.data })), balances };
}

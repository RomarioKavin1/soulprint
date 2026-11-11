/** History view helpers: plain-language events and the indexer lag notice (Review Focus 4). */
import { money } from "./money.ts";
import type { Currency } from "./terms.ts";

export function lagNotice(lag: { updating: boolean; behindMs: number; indexedHeight?: number }): string | null {
  if (lag.indexedHeight === 0) return "Updating — history is still being loaded. Balances on the piece itself are always current.";
  if (!lag.updating) return null;
  const m = Math.max(1, Math.round(lag.behindMs / 60_000));
  return `Updating — the last ${m} minute${m === 1 ? "" : "s"} of activity may not show yet. Balances on the piece itself are always current.`;
}

/** Review minor 9: a failed refresh after a good load is said, not hidden behind old figures. */
export function historyNotice(s: { hasData: boolean; refreshFailed: boolean }): string | null {
  return s.hasData && s.refreshFailed ? "History could not be refreshed; showing what was last loaded. Balances on the piece itself are always current." : null;
}

export function describeEvent(e: { event: string; data: any }, currency: Currency | "Ft", decimals: number): string {
  const c: Currency = currency === "Ft" ? { Ft: "" } : currency;
  const $ = (v: string) => money(v, c, decimals);
  const d = e.data;
  switch (e.event) {
    case "piece_created": return `${d.artist} created the piece`;
    case "funded": return `${d.payer} paid ${$(d.amount)} into the piece`;
    case "milestone_released": return `Stage ${d.index + 1} released: ${$(d.amount)} to the artist`;
    case "delivered": return "The artist delivered";
    case "changes_requested": return `Changes requested (round ${d.round})`;
    case "settled": return `Complete: ${$(d.artist_amount)} to the artist`;
    case "rejected": return `${d.by} refused the delivery`;
    case "bond_posted": return `${d.by} posted a ${$(d.amount)} refusal deposit`;
    case "bond_paid": return `Refusal deposit of ${$(d.amount)} paid to ${d.to}`;
    case "split_proposed": return `${d.by} proposed ${d.artist_bps / 100}% to the artist`;
    case "resolved": return `${d.by} decided: ${$(d.artist_amount)} to the artist, ${$(d.owner_amount)} to the client`;
    case "refunded": return `${$(d.amount)} refunded to ${d.to}`;
    case "cancelled": return "Cancelled by agreement";
    case "income": return `${d.payer} paid ${$(d.amount)} to the holder`;
    case "withdraw": return `${d.owner} took ${$(d.amount)} of holder income`;
    case "listed": return `Listed for ${$(d.price)}`;
    case "delisted": return "Taken off sale";
    case "sold": return `${d.seller} sold it to ${d.buyer} for ${$(d.price)} (${$(d.royalty)} royalty to the artist)`;
    case "owner_changed": return `Now owned by ${d.new_owner}`;
    case "claim": return `${d.creditor} collected ${$(d.amount)}`;
    case "claim_restored": return `A payout to ${d.creditor} bounced; ${$(d.amount)} is back in their credit`;
    case "anchored": return `Process anchored: ${d.count} frames`;
    case "challenge_issued": return `${d.issuer} asked for a live code`;
    case "challenge_acked": return "The artist acknowledged the live code";
    case "attested": return `Record signed (level E${d.evidence_level})`;
    default: return e.event.replaceAll("_", " ");
  }
}

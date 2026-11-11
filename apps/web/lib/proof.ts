/** Proof page model: what can be said about a piece, from chain views and the published report. */
import type { PieceInfo } from "./piece.ts";
import { GRANT_TEXT } from "./terms.ts";
import type { Level } from "./wording.ts";

/** A29 rules are enforced on chain (`commissioned_badge`); the page also requires a settled commission. */
export function showBadge(p: Pick<PieceInfo, "mode" | "status" | "commissioned_badge">) {
  return p.mode === "Commission" && p.status === "Settled" && p.commissioned_badge;
}

/**
 * The level the page may show: the attested level, unless the attesting key was withdrawn, the
 * attestation is for another report, or the published report does not hash to the piece's
 * `report_hash` (A36). In those cases the page falls back to "declared" and says why.
 */
export function displayLevel(
  att: { evidence_level: number; key_id: number; report_hash: string },
  revokedKeyIds: number[],
  chainReportHash: string | null,
  recomputedHash: string | null,
): { level: Level; note: string | null } {
  const level = (att.evidence_level === 3 ? 3 : att.evidence_level === 2 ? 2 : 0) as Level;
  if (level === 0) return { level: 0, note: null };
  if (revokedKeyIds.includes(att.key_id))
    return { level: 0, note: "The evidence service key that signed this record was later withdrawn, so the record is shown as unverified." };
  if (!chainReportHash || att.report_hash !== chainReportHash)
    return { level: 0, note: "The signed record on the piece is for a different report than the one delivered." };
  if (recomputedHash !== chainReportHash) return { level: 0, note: "The report shown here does not match the fingerprint recorded on the piece." };
  return { level, note: null };
}

/** Public facts about the piece. Deliberately has no price (Plan 3 Global Constraints). */
export function proofModel({ piece }: { piece: PieceInfo }) {
  return {
    pieceId: piece.piece_id,
    tokenId: piece.token_id,
    artist: piece.artist,
    owner: piece.owner,
    mode: piece.mode,
    badge: showBadge(piece),
    rights: `${GRANT_TEXT[piece.grant.kind].title}${piece.grant.attribution ? ", with credit to the artist" : ""}. ${GRANT_TEXT[piece.grant.kind].plain}`,
    royalty: `${piece.royalty_bps / 100}% of every resale goes to the artist.`,
  };
}

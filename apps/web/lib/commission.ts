/**
 * Commission room rules: which steps a person can take now, and the exact calls behind them.
 * Everything is derived from the piece's on-chain state on every render; nothing is remembered
 * locally (Review Focus 1: a reload after paying shows "paid" because the chain says so).
 */
import { b64 } from "@soulprint/proof";
import { ChainError } from "./near.ts";
import type { PieceInfo, Status } from "./piece.ts";
import { rejectBond, termsHash, type TermsJson } from "./terms.ts";
import { money } from "./money.ts";

export type Action =
  | "fund" | "release_milestone" | "challenge" | "request_changes" | "accept" | "reject" | "settle" | "refund"
  | "propose_split" | "accept_split" | "mutual_cancel" | "resolve" | "timeout_resolve";

export interface Call { contract: string; method: string; args: Record<string, unknown>; deposit: bigint; tgas: bigint }

const nowNs = (ms: number) => BigInt(ms) * 1_000_000n;

export function actionsFor(p: PieceInfo, t: TermsJson | null, me: string | null, nowMs: number): Action[] {
  if (!me || p.mode !== "Commission" || !t) return [];
  const isOwner = me === p.owner && me !== p.artist;
  const isArtist = me === p.artist;
  const a: Action[] = [];
  const reviewOpen = p.review_ends_at !== null && nowNs(nowMs) < BigInt(p.review_ends_at);
  switch (p.status) {
    case "Offered":
      if (!isArtist && (t.client === null || t.client === me)) a.push("fund");
      break;
    case "InProgress":
      if (isOwner) {
        a.push("challenge");
        if (p.released_milestones < t.milestones.length - 1) a.push("release_milestone");
        a.push("mutual_cancel");
      }
      if (isArtist) a.push("mutual_cancel");
      break;
    case "Delivered":
      if (isOwner && reviewOpen) {
        a.push("accept");
        if (p.revisions_used < t.revision_rounds) a.push("request_changes");
        a.push("reject");
      } else if (isOwner) a.push("accept");
      if (!reviewOpen) a.push("settle");
      break;
    case "Disputed":
      if ((p.dispute_stage === "Arbitrator" && me === t.arbitrator) || (p.dispute_stage === "Fallback" && me === t.fallback_arbitrator)) a.push("resolve");
      if (p.dispute_stage === "TimedOut") a.push("timeout_resolve");
      else if (isOwner || isArtist) {
        a.push("propose_split");
        if (p.split && p.split.by !== me) a.push("accept_split");
      }
      break;
  }
  if (p.refund_eligible && isOwner) a.push("refund");
  return [...new Set(a)];
}

/** Fund: the hash is recomputed from the terms the person was shown (A13/T: terms can't be swapped). */
export function fundCall(p: Pick<PieceInfo, "piece_id" | "currency" | "price">, shown: TermsJson, ftToken: string): Call {
  const expected = b64.encode(termsHash(shown));
  if (shown.currency === "Near")
    return { contract: p.piece_id, method: "fund", args: { expected_terms_hash: expected }, deposit: BigInt(shown.price), tgas: 100n };
  return {
    contract: ftToken,
    method: "ft_transfer_call",
    args: { receiver_id: p.piece_id, amount: shown.price, msg: JSON.stringify({ action: "fund", expected_terms_hash: expected }) },
    deposit: 1n,
    tgas: 150n,
  };
}

export function bondOf(t: TermsJson) {
  return rejectBond(BigInt(t.price), t.reject_bond_bps);
}

export function rejectCall(p: Pick<PieceInfo, "piece_id">, t: TermsJson, ftToken: string): Call {
  const bond = bondOf(t);
  if (t.currency === "Near") return { contract: p.piece_id, method: "reject", args: {}, deposit: bond === 0n ? 1n : bond, tgas: 100n };
  return { contract: ftToken, method: "ft_transfer_call", args: { receiver_id: p.piece_id, amount: bond.toString(), msg: JSON.stringify({ action: "reject" }) }, deposit: 1n, tgas: 150n };
}

export function rejectConfirmText(p: PieceInfo, t: TermsJson, ftDecimals: number) {
  const bond = money(bondOf(t), t.currency, ftDecimals);
  return `Refusing this delivery sends ${bond} as a deposit into the piece. It opens the dispute process: first you and the artist can agree a split; then the arbitrators decide. The deposit comes back to you if the decision goes your way.`;
}

const STATUS_PHRASE: Record<Status, string> = {
  Offered: "still waiting for payment",
  InProgress: "back in progress",
  Delivered: "delivered and in review",
  Disputed: "now in dispute",
  Settled: "now complete",
  Refunded: "now refunded",
  Cancelled: "now cancelled",
};

/** Review Focus 2: when two people act at once, say who won according to the chain. */
export function explainRace(e: unknown, fresh: PieceInfo): string | null {
  if (!(e instanceof ChainError) || !["ERR_WRONG_STATUS", "ERR_NOT_OWNER", "ERR_REVIEW_CLOSED"].includes(e.code)) return null;
  return `Someone else acted first: the piece is ${STATUS_PHRASE[fresh.status]}. Your step was not applied, and any amount you sent was returned.`;
}

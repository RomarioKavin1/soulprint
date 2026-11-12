/** Piece reads and actions over the chain. The piece account is always the truth (Plan 3). */
import type { ChainView, Signer } from "./near.ts";
import { ONE_YOCTO, STORAGE_DEPOSIT } from "./near.ts";
import type { Currency, Grant, TermsJson } from "./terms.ts";

export type Status = "Offered" | "InProgress" | "Delivered" | "Disputed" | "Settled" | "Refunded" | "Cancelled";

export interface PieceInfo {
  piece_id: string;
  token_id: string;
  collection: string;
  mode: "Commission" | "Standalone";
  artist: string;
  owner: string;
  rotation_seq: string;
  status: Status;
  dispute_stage: string | null;
  transfer_pending: { from: string; to: string; seq: string; expires_at: string } | null;
  currency: Currency;
  price: string;
  royalty_bps: number;
  grant: Grant;
  grant_active: boolean;
  licence_text_hash: string;
  terms_hash: string | null;
  deadline: string;
  review_ends_at: string | null;
  refund_eligible: boolean;
  delivered_at: string | null;
  disputed_at: string | null;
  revisions_used: number;
  released_milestones: number;
  final_file_hash: string | null;
  report_hash: string | null;
  evidence_level: number;
  commissioned_badge: boolean;
  split: { by: string; artist_bps: number; nonce: number } | null;
  pending_addendum: unknown;
  addenda: unknown[];
  created_at: string;
}

export interface ProofView {
  segments: { key: string; genesis: string; head: string; count: number; last_anchor_at: string }[];
  anchors_total: number;
  segments_digest: string;
  invites: string[];
  challenges: { id: number; issuer: string; issuer_class: string; nonce_hash: string; issued_at: string; acked_at: string | null }[];
  challenges_total: number;
  attestation: { evidence_level: number; key_id: number; issued_at: string; attested_at: string; report_hash: string };
  final_file_hash: string | null;
  report_hash: string | null;
}

export interface Accounting {
  currency: Currency;
  funded: string;
  escrow: string;
  released: string;
  refunded: string;
  holder_pool: string;
  bond: string;
  liabilities: string;
  credits: { account: string; available: string; in_flight: string }[];
}

export function pieceAccount(tokenId: string, collection: string) {
  return `p${tokenId}.${collection}`;
}

export const STATUS_TEXT: Record<Status, string> = {
  Offered: "Waiting for the client's payment",
  InProgress: "In progress",
  Delivered: "Delivered — client reviewing",
  Disputed: "In dispute",
  Settled: "Complete",
  Refunded: "Refunded",
  Cancelled: "Cancelled",
};

/** A piece without a client has no payment to wait for: it is being made, then finished. */
export function statusText(p: Pick<PieceInfo, "mode" | "status">) {
  if (p.mode === "Standalone") return p.status === "Settled" ? "Finished" : p.status === "Offered" ? "Being made" : STATUS_TEXT[p.status];
  return STATUS_TEXT[p.status];
}

export async function pieceInfo(chain: ChainView, pieceId: string) {
  return chain.view<PieceInfo>(pieceId, "piece_info");
}
export async function proofPage(chain: ChainView, pieceId: string) {
  return chain.view<ProofView>(pieceId, "proof_page", { from: 0, limit: 32 });
}
export async function accounting(chain: ChainView, pieceId: string) {
  return chain.view<Accounting>(pieceId, "accounting");
}
export async function terms(chain: ChainView, pieceId: string) {
  return chain.view<TermsJson | null>(pieceId, "terms");
}

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<any> }>;
const browserFetch: Fetch = (u) => fetch(u);

/**
 * Every piece where `who` is the artist or the owner. The indexer says which pieces to look at;
 * each one is then read from its own account (the chain stays the truth). Without the indexer,
 * scan the collection (review minor 14).
 */
export async function piecesFor(chain: ChainView, collection: string, who: string, indexer: Fetch = browserFetch): Promise<PieceInfo[]> {
  let ids: string[] | null = null;
  try {
    const [a, o] = await Promise.all([indexer(`/indexer/artists/${who}/pieces`), indexer(`/indexer/owners/${who}/pieces`)]);
    if (a.ok && o.ok) ids = [...new Set([...(await a.json()).pieces, ...(await o.json()).pieces].map((p: { pieceId: string }) => p.pieceId))];
  } catch {
    ids = null;
  }
  const out: PieceInfo[] = [];
  if (ids) {
    const infos = await Promise.all(ids.map((id) => pieceInfo(chain, id).catch(() => null)));
    for (const i of infos) if (i && (i.artist === who || i.owner === who)) out.push(i);
  } else {
    for (let from = 0; ; from += 50) {
      const tokens = await chain.view<{ token_id: string; owner_id: string }[]>(collection, "nft_tokens", { from_index: String(from), limit: 50 });
      const infos = await Promise.all(tokens.map((t) => pieceInfo(chain, pieceAccount(t.token_id, collection)).catch(() => null)));
      for (const i of infos) if (i && (i.artist === who || i.owner === who)) out.push(i);
      if (tokens.length < 50) break;
    }
  }
  return out.sort((a, b) => Number(BigInt(b.created_at) - BigInt(a.created_at)));
}

export interface SoulprintEvent { event: string; data: any[] }
export function events(logs: string[]): SoulprintEvent[] {
  return logs
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map((l) => JSON.parse(l.slice("EVENT_JSON:".length)))
    .filter((e) => e.standard === "soulprint");
}

export type PieceKind = { Commission: TermsJson } | { Standalone: { currency: Currency; royalty_bps: number; grant: Grant; licence_text_hash: string } };

/** create_piece pays the collection's creation cost (storage for the new account). Returns the piece id. */
export async function createPiece(chain: ChainView, signer: Signer, collection: string, kind: PieceKind, capturePublicKey: string) {
  const currency = "Commission" in kind ? kind.Commission.currency : kind.Standalone.currency;
  const cost = BigInt(await chain.view<string>(collection, "piece_creation_cost", { currency }));
  const r = await signer.call(collection, "create_piece", { kind, capture_pubkey: capturePublicKey }, { deposit: cost, tgas: 300n });
  const created = events(r.logs).find((e) => e.event === "piece_created");
  if (!created) throw new Error("piece_not_created");
  return { pieceId: created.data[0].piece_id as string, tokenId: created.data[0].token_id as string, cost };
}

/** Gated non-value call (owner/artist actions): 1 yocto is the minimum; storage deposit refunded. */
export function act(signer: Signer, pieceId: string, method: string, args: Record<string, unknown> = {}) {
  return signer.call(pieceId, method, args, { deposit: STORAGE_DEPOSIT, tgas: 100n });
}
export { ONE_YOCTO, STORAGE_DEPOSIT };

/**
 * Relayer policy (Plan 3 Global Constraints + amendment): receivers = collection, `p<N>.<collection>`,
 * currency token; explicit methods; attached NEAR ≤ 0.01 (storage_deposit ≤ 0.00125); 50 per
 * account per UTC day. `create_piece` is not relayed. The chain checks the user's signature.
 */
import type { SignedDelegate } from "near-api-js";

export const NEAR_CAP = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const STORAGE_DEPOSIT_CAP = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

export interface Policy { collection: string; currencyToken: string }

const PIECE_METHODS = new Set([
  "accept", "request_changes", "release_milestone", "claim", "claim_to", "withdraw", "list", "delist", "issue_challenge",
  "invite_challenger", "add_capture_key", "deliver", "settle", "settle_standalone", "reopen_as_standalone", "propose_split",
  "accept_split", "resolve", "timeout_resolve", "consent_mutual_cancel", "consent_extend", "claim_refund", "propose_addendum",
  "accept_addendum", "anchor", "ack_challenge", "expire_pending", "cancel",
]);
const COLLECTION_METHODS = new Set(["nft_transfer", "nft_transfer_call", "sync_owner"]);
const TOKEN_METHODS = new Set(["ft_transfer_call", "storage_deposit"]);

export type Refusal = "receiver_not_allowed" | "method_not_allowed" | "deposit_over_cap" | "action_not_allowed" | "bad_args";

export function isPiece(id: string, collection: string) {
  const suffix = "." + collection;
  return id.endsWith(suffix) && /^p[0-9]+$/.test(id.slice(0, -suffix.length));
}

export function checkDelegate(sd: SignedDelegate, p: Policy): Refusal | null {
  const da = sd.delegateAction;
  const to = da.receiverId;
  const kind = to === p.collection ? "collection" : to === p.currencyToken ? "token" : isPiece(to, p.collection) ? "piece" : null;
  if (!kind) return "receiver_not_allowed";
  if (!da.actions.length) return "action_not_allowed";
  for (const a of da.actions) {
    const fc = (a as any).functionCall;
    if (!fc) return "action_not_allowed";
    const method: string = fc.methodName;
    const allowed = kind === "piece" ? PIECE_METHODS : kind === "collection" ? COLLECTION_METHODS : TOKEN_METHODS;
    if (!allowed.has(method)) return "method_not_allowed";
    const deposit = BigInt(fc.deposit);
    if (deposit > (method === "storage_deposit" ? STORAGE_DEPOSIT_CAP : NEAR_CAP)) return "deposit_over_cap";
    if (method === "ft_transfer_call") {
      let args: any;
      try {
        args = JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args))); // decoded Borsh gives a number array
      } catch {
        return "bad_args";
      }
      if (!isPiece(String(args?.receiver_id ?? ""), p.collection)) return "receiver_not_allowed";
    }
  }
  return null;
}

/** Per-account relays per UTC day. In memory: a restart resets the count (accepted for the demo). */
export class DailyCap {
  private used = new Map<string, number>();
  constructor(private limit: number) {}
  take(account: string, nowMs: number): boolean {
    const key = `${account}|${Math.floor(nowMs / 86_400_000)}`;
    const n = this.used.get(key) ?? 0;
    if (n >= this.limit) return false;
    this.used.set(key, n + 1);
    return true;
  }
}

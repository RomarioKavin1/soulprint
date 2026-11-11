/**
 * Relayer policy (Plan 3 Global Constraints + amendment): receivers = collection, `p<N>.<collection>`,
 * currency token; explicit methods; exactly one action (Plan 3 review C1); attached NEAR ≤ 0.01
 * (storage_deposit ≤ 0.00125, ft_transfer_call exactly 1 yocto); `create_piece` is not relayed.
 * Server-side (server.ts): signature and access key checked before any counter moves; the sender
 * must be a party of the target piece; per-sender count and relayer-wide NEAR budget per UTC day.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
  // One action: the cap below is then the whole deposit the relayer pays for this delegate.
  if (da.actions.length !== 1) return "action_not_allowed";
  for (const a of da.actions) {
    const fc = (a as any).functionCall;
    if (!fc) return "action_not_allowed";
    const method: string = fc.methodName;
    const allowed = kind === "piece" ? PIECE_METHODS : kind === "collection" ? COLLECTION_METHODS : TOKEN_METHODS;
    if (!allowed.has(method)) return "method_not_allowed";
    const deposit = BigInt(fc.deposit);
    const cap = method === "storage_deposit" ? STORAGE_DEPOSIT_CAP : method === "ft_transfer_call" ? 1n : NEAR_CAP;
    if (deposit > cap) return "deposit_over_cap";
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

/** The function call's JSON args, or null. */
export function callArgs(sd: SignedDelegate): any {
  const fc = (sd.delegateAction.actions[0] as any)?.functionCall;
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args)));
  } catch {
    return null;
  }
}

/** The piece a delegate acts on (party check), or null for token-level calls that need none. */
export function targetPiece(sd: SignedDelegate, p: Policy): string | null {
  const to = sd.delegateAction.receiverId;
  if (isPiece(to, p.collection)) return to;
  if (to === p.collection) {
    const id = String(callArgs(sd)?.token_id ?? "");
    return /^[0-9]+$/.test(id) ? `p${id}.${p.collection}` : "invalid";
  }
  return null; // currency token: ft_transfer_call (1 yocto) moves the sender's own tokens; storage_deposit is budgeted
}

/**
 * Units per key per UTC day (relays per sender, or µNEAR for the relayer budget). With `file`, the
 * counters are persisted (Plan 3 review I3: a restart no longer resets them); old days are pruned.
 */
export class DailyCap {
  private used = new Map<string, number>();
  constructor(private limit: number, private file?: string) {
    if (file) {
      try {
        this.used = new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))));
      } catch {
        /* first run */
      }
    }
  }
  private key(account: string, nowMs: number) {
    return `${account}|${Math.floor(nowMs / 86_400_000)}`;
  }
  can(account: string, nowMs: number, n = 1): boolean {
    return (this.used.get(this.key(account, nowMs)) ?? 0) + n <= this.limit;
  }
  take(account: string, nowMs: number, n = 1): boolean {
    if (!this.can(account, nowMs, n)) return false;
    const k = this.key(account, nowMs);
    this.used.set(k, (this.used.get(k) ?? 0) + n);
    const today = `|${Math.floor(nowMs / 86_400_000)}`;
    for (const key of this.used.keys()) if (!key.endsWith(today)) this.used.delete(key);
    if (this.file) writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.used)));
    return true;
  }
}

/** Relayer budget units: µNEAR (1e18 yocto), rounded up. */
export const budgetUnits = (yocto: bigint) => Number((yocto + 10n ** 18n - 1n) / 10n ** 18n);

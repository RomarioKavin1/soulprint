/**
 * The signed-in person. Two implementations behind one interface (Plan 3 Task 1 amendment):
 * `ConnectSigner` (NEAR Connect, testnet/mainnet) and `KeySigner` (keys from config/networks.json,
 * sandbox and E2E only).
 */
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { b58, b64, nearPublicKey } from "@soulprint/proof";
import { Account, actions as nearActions, encodeTransaction, FailoverRpcProvider, JsonRpcProvider, type Provider } from "near-api-js";
import { nep413Payload } from "./nep413.ts";

export const TGAS = 1_000_000_000_000n;
/** Review C2 (contracts): payable non-value calls attach this; the piece refunds what storage does not need. */
export const STORAGE_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const ONE_YOCTO = 1n;

/** Error → searchable text. Never throws: near-api-js errors carry BigInts, which JSON.stringify
 * refuses (testnet E2E: that TypeError replaced the real error and every call read "not confirmed"). */
export function errText(e: unknown): string {
  const safe = (v: unknown) => {
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) ?? "";
    } catch {
      return "";
    }
  };
  if (typeof e === "string") return e;
  if (e instanceof Error) return `${e.name} ${e.message} ${safe((e as any).cause ?? "")} ${safe(e)}`;
  return safe(e) || String(e);
}

export interface SignedNep413 { accountId: string; publicKey: string; signature: string }

export interface CallOptions { deposit?: bigint; tgas?: bigint }

export interface Signer {
  readonly accountId: string;
  signNep413(p: { message: string; nonce: Uint8Array; recipient: string }): Promise<SignedNep413>;
  /** Sends a function call and waits for the final outcome. Throws `ChainError` on any failed receipt. */
  call(contractId: string, method: string, args: Record<string, unknown>, opts?: CallOptions): Promise<CallOutcome>;
}

export interface CallOutcome { txHash: string; logs: string[]; value: unknown }

export class ChainError extends Error {
  constructor(public code: string, public txHash?: string) {
    super(code);
  }
}
/** Our transaction's nonce was used by another transaction from the same key: it can never land. */
export class NonceTaken extends Error {
  constructor(public txHash: string) {
    super("NONCE_TAKEN");
  }
}

/** First `ERR_*` code in a failed outcome, or the raw message. */
export function chainErrorCode(e: unknown): string {
  const s = errText(e);
  if (/NotEnoughBalance|LackBalanceForState|NotEnoughAllowance|insufficient balance/i.test(s)) return "ERR_NO_NEAR";
  return /ERR_[A-Z_a-z]+/.exec(s)?.[0] ?? /Smart contract panicked: ([^"\\]+)/.exec(s)?.[1] ?? "ERR_UNKNOWN";
}

export function outcome(r: any): CallOutcome {
  const receipts: any[] = r?.receipts_outcome ?? [];
  const failed = [r?.status, ...receipts.map((x) => x?.outcome?.status)].find((s) => s && typeof s === "object" && "Failure" in s);
  const txHash = String(r?.transaction?.hash ?? r?.transaction_outcome?.id ?? "");
  if (failed) throw new ChainError(chainErrorCode(failed), txHash);
  const logs: string[] = receipts.flatMap((x) => x?.outcome?.logs ?? []);
  // A refused FT action (fund/buy/reject/pay_income via ft_transfer_call) does not fail: the piece
  // logs its error code and the tokens are returned. Treat that as the error it is.
  const refused = logs.find((l) => /^ERR_[A-Z_a-z]+$/.test(l));
  if (refused) throw new ChainError(refused, txHash);
  let value: unknown = undefined;
  const sv = r?.status?.SuccessValue;
  if (typeof sv === "string" && sv.length) {
    try {
      value = JSON.parse(new TextDecoder().decode(b64.decode(sv)));
    } catch {
      value = sv;
    }
  }
  return { txHash, logs, value };
}

/**
 * RPC access for one or more endpoints. Free public RPCs rate-limit per client (FastNear answers
 * HTTP 429 after a burst; found on the testnet E2E): each provider retries with back-off, then
 * fails over to the next endpoint, and each instance starts at a random endpoint so several
 * tabs (or users behind one address) spread their load.
 */
export function rpcProvider(rpc: string | string[]): Provider {
  const urls = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
  const one = (url: string) => new JsonRpcProvider({ url }, { retries: 3, backoff: 2, wait: 400 });
  if (urls.length < 2) return one(urls[0] ?? "");
  const start = Math.floor(Math.random() * urls.length);
  return new FailoverRpcProvider([...urls.slice(start), ...urls.slice(0, start)].map(one));
}

const TRANSIENT = /429|408|Rate limit|Exceeded \d+ providers|fetch failed|ECONNRESET|ETIMEDOUT|Timeout|Internal server error|502|503|504/i;

/** Retry `f` while every endpoint is briefly overloaded (1, 2, 4, 8 s), then give up. */
export async function withRetry<T>(f: () => Promise<T>, waits = [1000, 2000, 4000, 8000]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= waits.length || !TRANSIENT.test(errText(e))) throw e;
      await new Promise((res) => setTimeout(res, waits[i]! * (0.75 + Math.random() / 2)));
    }
  }
}

/** Sandbox / E2E signer: a full-access key known to the app. Never used on testnet or mainnet. */
export class KeySigner implements Signer {
  private seed: Uint8Array;
  readonly publicKey: string;
  private account: Account;
  private provider: Provider;
  private rpcUrls: string[];
  constructor(readonly accountId: string, secret: string, rpc: string | string[]) {
    const raw = b58.decode(secret.replace(/^ed25519:/, ""));
    this.seed = raw.slice(0, 32);
    this.publicKey = nearPublicKey(raw.slice(32, 64));
    this.rpcUrls = (Array.isArray(rpc) ? rpc : [rpc]).filter(Boolean);
    this.provider = rpcProvider(rpc);
    this.account = new Account(accountId, this.provider, secret as `ed25519:${string}`);
  }
  async signNep413(p: { message: string; nonce: Uint8Array; recipient: string }): Promise<SignedNep413> {
    const sig = await ed.signAsync(sha256(nep413Payload(p)), this.seed);
    return { accountId: this.accountId, publicKey: this.publicKey, signature: b64.encode(sig) };
  }
  /**
   * Sign first, so the transaction hash is known; then send. Public RPCs time out (HTTP 408) or
   * rate-limit while a transaction may still land, so on a transport failure the outcome is read
   * back by hash instead of being reported as a failure (testnet E2E). A stale nonce (two tabs
   * signing with one key) is re-signed and resent.
   */
  async call(contractId: string, method: string, args: Record<string, unknown>, opts: CallOptions = {}): Promise<CallOutcome> {
    const action = nearActions.functionCall(method, args, (opts.tgas ?? 100n) * TGAS, opts.deposit ?? 0n);
    for (let attempt = 0; ; attempt++) {
      const signed = await withRetry(() => this.account.createSignedTransaction({ receiverId: contractId, actions: [action] }));
      const txHash = b58.encode(sha256(encodeTransaction(signed.transaction)));
      try {
        return outcome(await this.sendSame(signed, txHash));
      } catch (e) {
        if (e instanceof ChainError) throw e;
        const text = errText(e);
        if (e instanceof NonceTaken || /InvalidNonce|Invalid nonce/i.test(text)) {
          // near-api-js caches the nonce and only counts up; another tab or process signing with
          // this key moved the chain's nonce ahead (E2E: "ak 27000010, tx 27000004"). Drop the
          // cache so the next signature reads the chain's nonce.
          await (this.account as any).nonceManager?.invalidate?.(signed.transaction.publicKey, signed.transaction.nonceIndex);
          if (attempt < 5) {
            await new Promise((res) => setTimeout(res, 200 + Math.random() * 600));
            continue;
          }
          throw new ChainError("ERR_NONCE", txHash);
        }
        if (/^\s*(InvalidTx|InvalidNonce|NotEnoughBalance|Expired|InvalidSignature)/i.test((e as any)?.type ?? "") || /InvalidTxError|NotEnoughBalance/i.test(text))
          throw new ChainError(chainErrorCode(e), txHash);
        // Transport failure: the transaction may have landed. Ask for it by hash.
        const landed = await this.readBack(txHash);
        if (landed) return outcome(landed);
        console.warn("[soulprint] call not confirmed", method, txHash, e);
        throw new ChainError(chainErrorCode(e) === "ERR_UNKNOWN" ? "ERR_NOT_CONFIRMED" : chainErrorCode(e), txHash);
      }
    }
  }
  /**
   * Broadcast; on a transport error, check by hash and re-broadcast the SAME signed bytes (NEAR
   * de-duplicates by hash, so this can never run twice). Testnet E2E: a buy whose broadcast was
   * lost never landed, and the old code only waited for it.
   */
  private async sendSame(signed: any, txHash: string): Promise<any> {
    const stop = { done: false };
    try {
      return await Promise.race([this.broadcast(signed, txHash), this.watchDropped(signed, txHash, stop)]);
    } finally {
      stop.done = true;
    }
  }
  /**
   * A transaction whose nonce another transaction from the same key already used can never land
   * (testnet E2E: two tabs signing with one key at the same moment; the chain kept one and dropped
   * the other while the RPC kept us waiting for minutes). Seen twice — nonce used, our hash
   * unknown — means dropped: the caller re-signs with a fresh nonce.
   */
  private async watchDropped(signed: any, txHash: string, stop: { done: boolean }): Promise<never> {
    const nonce = BigInt(signed.transaction.nonce);
    const publicKey = signed.transaction.publicKey.toString();
    let unknownWithNonceUsed = 0;
    for (;;) {
      await new Promise((res) => setTimeout(res, 3000));
      if (stop.done) return new Promise<never>(() => undefined);
      try {
        const ak: any = await this.provider.query({ request_type: "view_access_key", finality: "optimistic", account_id: this.accountId, public_key: publicKey });
        if (BigInt(ak.nonce) < nonce) { unknownWithNonceUsed = 0; continue; }
        const known = await this.txKnown(txHash);
        unknownWithNonceUsed = known === false ? unknownWithNonceUsed + 1 : 0;
        if (unknownWithNonceUsed >= 2) throw new NonceTaken(txHash);
      } catch (e) {
        if (e instanceof NonceTaken) throw e;
      }
    }
  }
  /**
   * One plain status request per endpoint: near-api-js retries UNKNOWN_TRANSACTION ten times and
   * then reports only "RetriesExceeded", which cannot be told apart from an overloaded endpoint.
   * `false` = an endpoint says it does not know the transaction; `null` = no endpoint answered.
   */
  private async txKnown(txHash: string): Promise<boolean | null> {
    for (const url of this.rpcUrls) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "sp", method: "tx", params: { tx_hash: txHash, sender_account_id: this.accountId, wait_until: "NONE" } }),
          signal: AbortSignal.timeout(5000),
        });
        const j: any = await r.json();
        if (j?.result) return true;
        if (j?.error?.cause?.name === "UNKNOWN_TRANSACTION") return false;
      } catch {
        // try the next endpoint
      }
    }
    return null;
  }
  private async broadcast(signed: any, txHash: string): Promise<any> {
    for (let i = 0; ; i++) {
      try {
        return await this.provider.sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC");
      } catch (e) {
        const text = errText(e);
        if (i >= 3 || !TRANSIENT.test(text)) throw e;
        const landed = await this.readBack(txHash, 2);
        if (landed) return landed;
        await new Promise((res) => setTimeout(res, 1500 * 2 ** i));
      }
    }
  }
  private async readBack(txHash: string, tries = 20): Promise<any | null> {
    for (let i = 0; i < tries; i++) {
      try {
        return await this.provider.viewTransactionStatus({ txHash, accountId: this.accountId, waitUntil: "EXECUTED_OPTIMISTIC" });
      } catch (e) {
        if (!/UNKNOWN_TRANSACTION|TIMEOUT_ERROR|408|429|Rate limit|fetch failed|ECONN|Timeout/i.test(errText(e))) return null;
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
    return null;
  }
}

/** Wallet-backed signer via NEAR Connect. `wallet` is a connected NearWalletBase. */
export class ConnectSigner implements Signer {
  constructor(readonly accountId: string, private wallet: any) {}
  async signNep413(p: { message: string; nonce: Uint8Array; recipient: string }): Promise<SignedNep413> {
    const r = await this.wallet.signMessage({ message: p.message, recipient: p.recipient, nonce: p.nonce });
    const sig = typeof r.signature === "string" ? r.signature : b64.encode(r.signature);
    return { accountId: r.accountId ?? this.accountId, publicKey: String(r.publicKey), signature: sig };
  }
  async call(contractId: string, method: string, args: Record<string, unknown>, opts: CallOptions = {}): Promise<CallOutcome> {
    try {
      const r = await this.wallet.signAndSendTransaction({
        signerId: this.accountId,
        receiverId: contractId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName: method, args, gas: ((opts.tgas ?? 100n) * TGAS).toString(), deposit: (opts.deposit ?? 0n).toString() },
          },
        ],
      });
      return outcome(r);
    } catch (e) {
      if (e instanceof ChainError) throw e;
      throw new ChainError(chainErrorCode(e));
    }
  }
}

/** Read-only chain access (views always read the chain; no local "paid" state). */
export class ChainView {
  private provider: Provider;
  constructor(rpc: string | string[]) {
    this.provider = rpcProvider(rpc);
  }
  async view<T = any>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await withRetry(() => this.provider.callFunction({ contractId, method, args }))) as T;
  }
}

/** The service's own funded NEAR account (A35): anchors, challenge acks, attestations. */
import { sha256 } from "@noble/hashes/sha256";
import { b58 } from "@soulprint/proof";
import { actions, encodeTransaction, type Account, type Provider } from "near-api-js";

export interface AnchorArgs { pieceId: string; key: string; head: string; count: number; sig: string }
export interface AckArgs { pieceId: string; challengeId: number; sig: string }
/** `argsJson` is the exact JSON text (see report.ts: issued_at is a u64 number). */
export interface AttestArgs { collection: string; argsJson: string }
export interface Sender {
  anchor(a: AnchorArgs): Promise<{ txHash: string }>;
  ackChallenge(a: AckArgs): Promise<{ txHash: string }>;
  attest(a: AttestArgs): Promise<{ txHash: string }>;
  /** Ask the collection to re-read a piece's owner (index lag; anyone may call). */
  syncOwner(a: { collection: string; tokenId: string }): Promise<{ txHash: string }>;
}

const TGAS = 1_000_000_000_000n;

const TRANSIENT = /429|408|Rate limit|Exceeded \d+ providers|fetch failed|ECONNRESET|ETIMEDOUT|Timeout|Internal server error|502|503|504/i;
async function withRetry<T>(f: () => Promise<T>, waits = [1000, 2000, 4000, 8000]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= waits.length || !TRANSIENT.test(`${(e as Error)?.message ?? ""} ${JSON.stringify(e)}`)) throw e;
      await new Promise((res) => setTimeout(res, waits[i]!));
    }
  }
}

const failed = (r: any) =>
  [r?.status, ...(r?.receipts_outcome ?? []).map((x: any) => x?.outcome?.status)].some((s) => s && typeof s === "object" && "Failure" in s);

export class NearSender implements Sender {
  /**
   * With `provider`: sign first so the hash is known, send, and on a transport failure (HTTP 408,
   * 429, "Internal server error" — testnet E2E) read the outcome back by hash instead of failing or
   * sending a second transaction. Without it (unit tests): `callFunctionRaw`.
   */
  constructor(
    private account: Pick<Account, "callFunctionRaw"> & Partial<Pick<Account, "createSignedTransaction" | "accountId">>,
    private provider?: Pick<Provider, "sendTransactionUntil" | "viewTransactionStatus">,
    private readBackWaitMs = 2000,
    private hashOf: (signed: any) => string = (signed) => b58.encode(sha256(encodeTransaction(signed.transaction))),
  ) {}

  private async call(contractId: string, methodName: string, args: Record<string, unknown> | Uint8Array, tgas: bigint) {
    if (!this.provider || !this.account.createSignedTransaction) {
      const r: any = await this.account.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS });
      return { txHash: String(r?.transaction?.hash ?? r?.transaction_outcome?.id ?? "") };
    }
    for (let attempt = 0; ; attempt++) {
      const signed = await withRetry(() => this.account.createSignedTransaction!({ receiverId: contractId, actions: [actions.functionCall(methodName, args, tgas * TGAS, 0n)] }));
      const txHash = this.hashOf(signed);
      let r: any;
      try {
        r = await this.provider.sendTransactionUntil(signed, "FINAL");
      } catch (e) {
        const text = `${(e as Error)?.message ?? ""} ${JSON.stringify(e)}`;
        if (/InvalidNonce/i.test(text) && attempt < 3) continue;
        if (/InvalidTx|NotEnoughBalance|Expired|InvalidSignature/i.test(text)) throw e;
        r = await this.readBack(txHash);
        if (!r) throw e;
      }
      if (failed(r)) throw new Error(`${methodName} failed: ${JSON.stringify(r.status ?? r.receipts_outcome?.map((x: any) => x.outcome.status)).slice(0, 300)}`);
      return { txHash };
    }
  }

  private async readBack(txHash: string): Promise<any | null> {
    for (let i = 0; i < 15; i++) {
      try {
        return await this.provider!.viewTransactionStatus({ txHash, accountId: this.account.accountId!, waitUntil: "FINAL" });
      } catch (e) {
        if (!/UNKNOWN_TRANSACTION|TIMEOUT|408|429|Rate limit|Internal|fetch failed|ECONN/i.test(`${(e as Error)?.message ?? ""} ${JSON.stringify(e)}`)) return null;
        await new Promise((res) => setTimeout(res, this.readBackWaitMs));
      }
    }
    return null;
  }

  anchor(a: AnchorArgs) {
    return this.call(a.pieceId, "anchor", { key: a.key, head: a.head, count: a.count, sig: a.sig }, 50n);
  }
  ackChallenge(a: AckArgs) {
    return this.call(a.pieceId, "ack_challenge", { challenge_id: a.challengeId, sig: a.sig }, 30n);
  }
  syncOwner(a: { collection: string; tokenId: string }) {
    return this.call(a.collection, "sync_owner", { token_id: a.tokenId }, 50n);
  }
  attest(a: AttestArgs) {
    return this.call(a.collection, "attest", new TextEncoder().encode(a.argsJson), 100n);
  }
}

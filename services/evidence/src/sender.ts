/** The service's own funded NEAR account (A35): anchors, challenge acks, attestations. */
import type { Account } from "near-api-js";

export interface AnchorArgs { pieceId: string; key: string; head: string; count: number; sig: string }
export interface AckArgs { pieceId: string; challengeId: number; sig: string }
/** `argsJson` is the exact JSON text (see report.ts: issued_at is a u64 number). */
export interface AttestArgs { collection: string; argsJson: string }
export interface Sender {
  anchor(a: AnchorArgs): Promise<{ txHash: string }>;
  ackChallenge(a: AckArgs): Promise<{ txHash: string }>;
  attest(a: AttestArgs): Promise<{ txHash: string }>;
}

const TGAS = 1_000_000_000_000n;

export class NearSender implements Sender {
  constructor(private account: Pick<Account, "callFunctionRaw">) {}

  private async call(contractId: string, methodName: string, args: Record<string, unknown> | Uint8Array, tgas: bigint) {
    const r: any = await this.account.callFunctionRaw({ contractId, methodName, args, gas: tgas * TGAS });
    return { txHash: String(r?.transaction?.hash ?? r?.transaction_outcome?.id ?? "") };
  }

  anchor(a: AnchorArgs) {
    return this.call(a.pieceId, "anchor", { key: a.key, head: a.head, count: a.count, sig: a.sig }, 50n);
  }
  ackChallenge(a: AckArgs) {
    return this.call(a.pieceId, "ack_challenge", { challenge_id: a.challengeId, sig: a.sig }, 30n);
  }
  attest(a: AttestArgs) {
    return this.call(a.collection, "attest", new TextEncoder().encode(a.argsJson), 100n);
  }
}

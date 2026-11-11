/**
 * The signed-in person. Two implementations behind one interface (Plan 3 Task 1 amendment):
 * `ConnectSigner` (NEAR Connect, testnet/mainnet) and `KeySigner` (keys from config/networks.json,
 * sandbox and E2E only).
 */
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { b58, b64, nearPublicKey } from "@soulprint/proof";
import { Account, JsonRpcProvider } from "near-api-js";
import { nep413Payload } from "./nep413.ts";

export const TGAS = 1_000_000_000_000n;
/** Review C2 (contracts): payable non-value calls attach this; the piece refunds what storage does not need. */
export const STORAGE_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const ONE_YOCTO = 1n;

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

/** First `ERR_*` code in a failed outcome, or the raw message. */
export function chainErrorCode(e: unknown): string {
  let s: string;
  if (typeof e === "string") s = e;
  else if (e instanceof Error) s = `${e.message} ${JSON.stringify((e as any).cause ?? "")} ${JSON.stringify(e)}`;
  else s = JSON.stringify(e) ?? String(e);
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

/** Sandbox / E2E signer: a full-access key known to the app. Never used on testnet or mainnet. */
export class KeySigner implements Signer {
  private seed: Uint8Array;
  readonly publicKey: string;
  private account: Account;
  constructor(readonly accountId: string, secret: string, rpcUrl: string) {
    const raw = b58.decode(secret.replace(/^ed25519:/, ""));
    this.seed = raw.slice(0, 32);
    this.publicKey = nearPublicKey(raw.slice(32, 64));
    this.account = new Account(accountId, rpcUrl, secret as `ed25519:${string}`);
  }
  async signNep413(p: { message: string; nonce: Uint8Array; recipient: string }): Promise<SignedNep413> {
    const sig = await ed.signAsync(sha256(nep413Payload(p)), this.seed);
    return { accountId: this.accountId, publicKey: this.publicKey, signature: b64.encode(sig) };
  }
  async call(contractId: string, method: string, args: Record<string, unknown>, opts: CallOptions = {}): Promise<CallOutcome> {
    try {
      const r = await this.account.callFunctionRaw({
        contractId,
        methodName: method,
        args,
        deposit: opts.deposit ?? 0n,
        gas: (opts.tgas ?? 100n) * TGAS,
      });
      return outcome(r);
    } catch (e) {
      if (e instanceof ChainError) throw e;
      throw new ChainError(chainErrorCode(e));
    }
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
  private provider: JsonRpcProvider;
  constructor(readonly rpcUrl: string) {
    this.provider = new JsonRpcProvider({ url: rpcUrl });
  }
  async view<T = any>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.provider.callFunction({ contractId, method, args })) as T;
  }
}

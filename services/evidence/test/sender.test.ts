import { describe, expect, it } from "vitest";
import { NearSender } from "../src/sender.ts";

describe("NearSender", () => {
  it("anchor_relay_builds_correct_args", async () => {
    const calls: any[] = [];
    const s = new NearSender({ callFunctionRaw: async (a: any) => { calls.push(a); return { transaction: { hash: "h" } }; } } as any);
    const r = await s.anchor({ pieceId: "p1.c.near", key: "ed25519:abc", head: "AAAA", count: 5, sig: "BBBB" });
    expect(r.txHash).toBe("h");
    expect(calls[0]).toMatchObject({
      contractId: "p1.c.near", methodName: "anchor",
      args: { key: "ed25519:abc", head: "AAAA", count: 5, sig: "BBBB" },
    });
    expect(BigInt(calls[0].gas)).toBeGreaterThanOrEqual(30_000_000_000_000n);
    expect(calls[0].deposit ?? 0n).toBeFalsy();
  });
});

describe("NearSender on a flaky public RPC (testnet E2E)", () => {
  const account = (n: { signed: number }) => ({
    accountId: "svc.testnet",
    callFunctionRaw: async () => { throw new Error("not used"); },
    createSignedTransaction: async () => { n.signed++; return { transaction: {} } as any; },
  });
  const ok = { status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }] };
  const hash = () => "TXHASH";

  it("a send that errors in transport is read back by hash, not resent", async () => {
    const n = { signed: 0 }, asked: string[] = [];
    let sends = 0;
    const provider = {
      sendTransactionUntil: async () => { sends++; throw new Error("Internal server error"); },
      viewTransactionStatus: async (a: any) => { asked.push(a.txHash); return asked.length < 2 ? Promise.reject(new Error("UNKNOWN_TRANSACTION")) : ok; },
    };
    const r = await new NearSender(account(n) as any, provider as any, 1, hash).attest({ collection: "c.testnet", argsJson: "{}" });
    expect(r.txHash).toBe("TXHASH");
    expect([sends, n.signed]).toEqual([1, 1]);
    expect(asked).toEqual(["TXHASH", "TXHASH"]);
  });

  it("a transaction that never shows up is still an error", async () => {
    const provider = {
      sendTransactionUntil: async () => { throw new Error("408 Request Timeout"); },
      viewTransactionStatus: async () => { throw new Error("UNKNOWN_TRANSACTION"); },
    };
    await expect(new NearSender(account({ signed: 0 }) as any, provider as any, 1, hash).attest({ collection: "c.testnet", argsJson: "{}" })).rejects.toThrow(/408/);
  });

  it("a failed outcome is an error", async () => {
    const provider = {
      sendTransactionUntil: async () => ({ status: { Failure: { ActionError: {} } }, receipts_outcome: [] }),
      viewTransactionStatus: async () => ok,
    };
    await expect(new NearSender(account({ signed: 0 }) as any, provider as any, 1, hash).attest({ collection: "c.testnet", argsJson: "{}" })).rejects.toThrow(/attest failed/);
  });

  it("a stale nonce drops the nonce cache and re-signs (E2E: 'ak 27000010, tx 27000004')", async () => {
    let invalidated = 0, sends = 0;
    const acc = { ...account({ signed: 0 }), nonceManager: { invalidate: async () => { invalidated++; } } };
    const provider = {
      sendTransactionUntil: async () => { if (sends++ === 0) throw new Error("Invalid nonce (ak: 27000010, tx: 27000004)"); return ok; },
      viewTransactionStatus: async () => ok,
    };
    await new NearSender(acc as any, provider as any, 1, hash).anchor({ pieceId: "p1.c.testnet", key: "k", head: "h", count: 1, sig: "s" });
    expect([invalidated, sends]).toEqual([1, 2]);
  });

  it("a lost broadcast is resent as the same signed transaction (testnet E2E: a buy never landed)", async () => {
    const n = { signed: 0 };
    const seen: unknown[] = [];
    let sends = 0;
    const provider = {
      sendTransactionUntil: async (signed: unknown) => { seen.push(signed); if (sends++ < 2) throw new Error("fetch failed"); return ok; },
      viewTransactionStatus: async () => { throw new Error("UNKNOWN_TRANSACTION"); },
    };
    await new NearSender(account(n) as any, provider as any, 1, hash).attest({ collection: "c.testnet", argsJson: "{}" });
    expect(sends).toBe(3);
    expect(n.signed).toBe(1); // signed once; the same bytes went out three times
    expect(new Set(seen).size).toBe(1);
  });
});

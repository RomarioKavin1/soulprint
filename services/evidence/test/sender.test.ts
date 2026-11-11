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

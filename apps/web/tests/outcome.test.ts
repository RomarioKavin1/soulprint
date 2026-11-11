import { describe, expect, it } from "vitest";
import { ChainError, outcome } from "../lib/near.ts";

const ok = { SuccessValue: "" };
const tx = (logs: string[][], status: any = ok) => ({
  status,
  transaction: { hash: "h" },
  receipts_outcome: logs.map((l) => ({ outcome: { logs: l, status: ok } })),
});

describe("call outcome", () => {
  it("a refused FT action (piece logs ERR_…, tokens returned) is an error, not a success", () => {
    expect(() => outcome(tx([["Transfer 5 from client to p1"], ["ERR_WRONG_STATUS"], ["Refund 5 from p1 to client"]]))).toThrow(ChainError);
    try {
      outcome(tx([[], ["ERR_TERMS_CHANGED"]]));
    } catch (e) {
      expect((e as ChainError).code).toBe("ERR_TERMS_CHANGED");
    }
  });
  it("success with events is a success", () => {
    const r = outcome(tx([["EVENT_JSON:{\"standard\":\"soulprint\",\"event\":\"funded\",\"data\":[]}"]]));
    expect(r.logs).toHaveLength(1);
  });
  it("a failed receipt is an error with its code", () => {
    const failed = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: ERR_NOT_OWNER" } } } } };
    expect(() => outcome({ status: failed, transaction: { hash: "h" }, receipts_outcome: [] })).toThrow(/ERR_NOT_OWNER/);
  });
});

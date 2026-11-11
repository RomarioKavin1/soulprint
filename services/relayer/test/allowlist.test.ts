import { describe, expect, it } from "vitest";
import { actions, buildDelegateAction, decodeSignedDelegate, encodeSignedDelegate, KeyPair, SignedDelegate, Signature } from "near-api-js";
import { checkDelegate, DailyCap, NEAR_CAP, STORAGE_DEPOSIT_CAP } from "../src/allowlist.ts";
import { buildRelayer } from "../src/server.ts";

const C = "soulprint.test.near";
const policy = { collection: C, currencyToken: "usdc.test.near" };
const pk = KeyPair.fromRandom("ed25519").getPublicKey();

function delegate(receiverId: string, method: string, args: object = {}, deposit = 0n, senderId = "client.test.near") {
  const da = buildDelegateAction({
    senderId, receiverId, nonce: 1n, maxBlockHeight: 1000n, publicKey: pk,
    actions: [actions.functionCall(method, new TextEncoder().encode(JSON.stringify(args)), 30_000_000_000_000n, deposit)],
  });
  // Round-trip through Borsh: this is what the server sees.
  return decodeSignedDelegate(encodeSignedDelegate(new SignedDelegate({ delegateAction: da, signature: new Signature({ keyType: 0, data: new Uint8Array(64) }) })));
}

describe("relayer allowlist", () => {
  it("rejects_unlisted_receiver", () => {
    expect(checkDelegate(delegate("evil.near", "accept"), policy)).toBe("receiver_not_allowed");
    expect(checkDelegate(delegate(`p1.${C}.evil.near`, "accept"), policy)).toBe("receiver_not_allowed");
    expect(checkDelegate(delegate(`x1.${C}`, "accept"), policy)).toBe("receiver_not_allowed");
    expect(checkDelegate(delegate(`p12.${C}`, "accept", {}, 1n), policy)).toBeNull();
  });
  it("rejects_unlisted_method", () => {
    expect(checkDelegate(delegate(`p1.${C}`, "on_transfer_result"), policy)).toBe("method_not_allowed");
    expect(checkDelegate(delegate(C, "create_piece"), policy)).toBe("method_not_allowed"); // amendment: not relayed
    expect(checkDelegate(delegate("usdc.test.near", "ft_transfer"), policy)).toBe("method_not_allowed");
    expect(checkDelegate(delegate("usdc.test.near", "ft_transfer_call", { receiver_id: "evil.near", amount: "1", msg: "" }, 1n), policy)).toBe("receiver_not_allowed");
    expect(checkDelegate(delegate("usdc.test.near", "ft_transfer_call", { receiver_id: `p3.${C}`, amount: "1", msg: "{}" }, 1n), policy)).toBeNull();
  });
  it("rejects_deposit_over_cap", () => {
    expect(checkDelegate(delegate(`p1.${C}`, "accept", {}, NEAR_CAP), policy)).toBeNull();
    expect(checkDelegate(delegate(`p1.${C}`, "accept", {}, NEAR_CAP + 1n), policy)).toBe("deposit_over_cap");
    expect(checkDelegate(delegate("usdc.test.near", "storage_deposit", {}, STORAGE_DEPOSIT_CAP), policy)).toBeNull();
    expect(checkDelegate(delegate("usdc.test.near", "storage_deposit", {}, STORAGE_DEPOSIT_CAP + 1n), policy)).toBe("deposit_over_cap");
  });
  it("only function calls, one receiver per delegate", () => {
    const sd = delegate(`p1.${C}`, "accept");
    sd.delegateAction.actions.push(actions.transfer(5n));
    expect(checkDelegate(sd, policy)).toBe("action_not_allowed");
  });
  it("enforces_daily_cap (50 per account per UTC day)", () => {
    const cap = new DailyCap(50);
    const day = Date.UTC(2026, 10, 11, 10);
    for (let i = 0; i < 50; i++) expect(cap.take("a.near", day)).toBe(true);
    expect(cap.take("a.near", day)).toBe(false);
    expect(cap.take("b.near", day)).toBe(true);
    expect(cap.take("a.near", day + 86_400_000)).toBe(true);
  });
  it("relays_valid_anchor: a valid delegate is submitted once, unchanged", async () => {
    const sent: SignedDelegate[] = [];
    const app = await buildRelayer({ policy, cap: new DailyCap(50), now: Date.now, submit: async (sd) => { sent.push(sd); return { txHash: "h" }; } });
    const sd = delegate(`p1.${C}`, "anchor", { key: "k", head: "h", count: 3, sig: "s" });
    const body = { signedDelegate: Buffer.from(encodeSignedDelegate(sd)).toString("base64") };
    const r = await app.inject({ method: "POST", url: "/relay", payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ txHash: "h" });
    expect(sent).toHaveLength(1);
    expect(Buffer.from(encodeSignedDelegate(sent[0]!))).toEqual(Buffer.from(encodeSignedDelegate(sd)));
    const bad = await app.inject({ method: "POST", url: "/relay", payload: { signedDelegate: Buffer.from(encodeSignedDelegate(delegate("evil.near", "x"))).toString("base64") } });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().error).toBe("receiver_not_allowed");
    expect((await app.inject({ method: "POST", url: "/relay", payload: { signedDelegate: "!!" } })).statusCode).toBe(400);
  });
});

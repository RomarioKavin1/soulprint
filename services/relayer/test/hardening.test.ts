/** Plan 3 review C1 and I3: the relayer must not be a faucet, and junk must not lock users out. */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
import { actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, KeyPair, SignedDelegate, Signature } from "near-api-js";
import { checkDelegate, DailyCap, NEAR_CAP } from "../src/allowlist.ts";
import { buildRelayer, type RelayerChain } from "../src/server.ts";

const C = "soulprint.test.near";
const policy = { collection: C, currencyToken: "usdc.test.near" };
const kp = KeyPair.fromRandom("ed25519");

function signed(receiverId: string, calls: [string, object, bigint][], senderId = "client.test.near", key = kp, forge = false) {
  const da = buildDelegateAction({
    senderId, receiverId, nonce: 1n, maxBlockHeight: 1000n, publicKey: key.getPublicKey(),
    actions: calls.map(([m, a, dep]) => actions.functionCall(m, new TextEncoder().encode(JSON.stringify(a)), 30_000_000_000_000n, dep)),
  });
  const sig = forge ? new Uint8Array(64) : key.sign(sha256(encodeDelegateAction(da))).signature;
  return new SignedDelegate({ delegateAction: da, signature: new Signature({ keyType: 0, data: sig }) });
}
const body = (sd: SignedDelegate) => ({ signedDelegate: Buffer.from(encodeSignedDelegate(sd)).toString("base64") });

/** client.test.near holds `kp`; p1 has artist + client as parties. */
const chain: RelayerChain = {
  async hasKey(account, publicKey) { return account === "client.test.near" && publicKey === kp.getPublicKey().toString(); },
  async parties(piece) { return piece === `p1.${C}` ? ["artist.test.near", "client.test.near"] : null; },
};

async function relayer(over: Partial<Parameters<typeof buildRelayer>[0]> = {}) {
  const sent: SignedDelegate[] = [];
  const app = await buildRelayer({
    policy, chain, cap: new DailyCap(50), budget: new DailyCap(Number(NEAR_CAP * 3n / 10n ** 18n)), now: () => Date.UTC(2026, 10, 11),
    submit: async (sd) => { sent.push(sd); return { txHash: "h", ok: true }; }, ...over,
  });
  return { app, sent };
}

describe("relayer hardening (Plan 3 review C1, I3)", () => {
  it("rejects_many_actions", () => {
    const sd = signed(`p1.${C}`, [["accept", {}, NEAR_CAP], ["accept", {}, NEAR_CAP]]);
    expect(checkDelegate(sd, policy)).toBe("action_not_allowed");
  });

  it("rejects_sender_not_party", async () => {
    const { app, sent } = await relayer({ chain: { ...chain, hasKey: async () => true } });
    const r = await app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, 1n]], "stranger.test.near")) });
    expect([r.statusCode, r.json().error]).toEqual([403, "sender_not_party"]);
    const t = await app.inject({ method: "POST", url: "/relay", payload: body(signed(C, [["nft_transfer", { receiver_id: "x.near", token_id: "1" }, 1n]], "stranger.test.near")) });
    expect([t.statusCode, t.json().error]).toEqual([403, "sender_not_party"]);
    expect(sent).toHaveLength(0);
  });

  it("forged_signatures_do_not_spend_the_victims_cap", async () => {
    const { app, sent } = await relayer();
    for (let i = 0; i < 60; i++) {
      const r = await app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, 1n]], "client.test.near", kp, true)) });
      expect(r.statusCode).toBe(401);
    }
    // A key the sender does not hold is refused too.
    const other = KeyPair.fromRandom("ed25519");
    expect((await app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, 1n]], "client.test.near", other)) })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, 1n]])) })).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("failed_submits_do_not_spend_the_cap; the inner outcome is returned", async () => {
    let fail = true;
    const { app } = await relayer({ cap: new DailyCap(2), submit: async () => { if (fail) throw new Error("rpc down"); return { txHash: "h", ok: false, failure: "ERR_NOT_OWNER" }; } });
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, 1n]])) })).statusCode).toBe(502);
    fail = false;
    const r = await app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, 1n]])) });
    expect(r.json()).toMatchObject({ txHash: "h", ok: false, failure: "ERR_NOT_OWNER" });
  });

  it("a relayer-wide daily NEAR budget bounds attached deposits", async () => {
    const { app, sent } = await relayer(); // budget: 3 × 0.01 NEAR (in milliNEAR units)
    const go = () => app.inject({ method: "POST", url: "/relay", payload: body(signed(`p1.${C}`, [["accept", {}, NEAR_CAP]])) });
    for (let i = 0; i < 3; i++) expect((await go()).statusCode).toBe(200);
    expect([(await go()).statusCode]).toEqual([429]);
    expect(sent).toHaveLength(3);
  });

  it("daily caps survive a restart when given a file", async () => {
    const { mkdtempSync } = await import("node:fs"), { join } = await import("node:path"), { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "relayer-")), "caps.json");
    const day = Date.UTC(2026, 10, 11);
    const a = new DailyCap(2, file);
    a.take("x.near", day); a.take("x.near", day);
    expect(new DailyCap(2, file).take("x.near", day)).toBe(false);
  });
});

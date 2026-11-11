import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64 } from "@soulprint/proof";
import { actionsFor, fundCall, rejectCall, rejectConfirmText, explainRace } from "../lib/commission.ts";
import { termsHash } from "../lib/terms.ts";
import { ChainError } from "../lib/near.ts";

const v = JSON.parse(readFileSync(new URL("../../../contracts/common/test-vectors/terms.json", import.meta.url), "utf8")).vectors;
const ftTerms = v[0].terms; // USDC, client client.test.near, 2 stages, 2 rounds
const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;
const ns = (ms: number) => String(BigInt(ms) * 1_000_000n);

function info(over: Record<string, unknown> = {}): any {
  return {
    piece_id: "p1.soulprint.test.near", token_id: "1", mode: "Commission", artist: "artist.test.near", owner: "artist.test.near",
    status: "Offered", currency: ftTerms.currency, price: ftTerms.price, terms_hash: v[0].hash, review_ends_at: null,
    refund_eligible: false, revisions_used: 0, released_milestones: 0, split: null, dispute_stage: null, transfer_pending: null, ...over,
  };
}

describe("commission room", () => {
  it("fund_sends_expected_terms_hash (FT and NEAR)", () => {
    const c = fundCall(info(), ftTerms, "usdc.test.near");
    expect(c).toMatchObject({ contract: "usdc.test.near", method: "ft_transfer_call", deposit: 1n });
    expect(c.args.receiver_id).toBe("p1.soulprint.test.near");
    expect(c.args.amount).toBe(ftTerms.price);
    expect(JSON.parse(c.args.msg as string)).toEqual({ action: "fund", expected_terms_hash: b64.encode(termsHash(ftTerms)) });
    const nearTerms = v[1].terms;
    const n = fundCall(info({ currency: "Near", price: nearTerms.price }), nearTerms, "usdc.test.near");
    expect(n).toMatchObject({ contract: "p1.soulprint.test.near", method: "fund", deposit: BigInt(nearTerms.price) });
    expect(n.args).toEqual({ expected_terms_hash: v[1].hash });
  });

  it("the hash sent is recomputed from the terms shown, not copied from the piece", () => {
    const shown = { ...ftTerms, price: "1" }; // what the person saw differs from the piece
    const c = fundCall(info(), shown, "usdc.test.near");
    expect(JSON.parse(c.args.msg as string).expected_terms_hash).not.toBe(v[0].hash);
  });

  it("reject_shows_bond_amount_before_confirm", () => {
    const d = info({ status: "Delivered", owner: "client.test.near", review_ends_at: ns(NOW + DAY_MS) });
    expect(rejectConfirmText(d, ftTerms, 6)).toMatch(/5 USDC/); // 5% of 100 USDC
    const r = rejectCall(d, ftTerms, "usdc.test.near");
    expect(r).toMatchObject({ contract: "usdc.test.near", method: "ft_transfer_call" });
    expect(r.args.amount).toBe("5000000");
    expect(JSON.parse(r.args.msg as string)).toEqual({ action: "reject" });
  });

  it("refund_button_only_when_eligible", () => {
    const base = { status: "InProgress", owner: "client.test.near" };
    expect(actionsFor(info({ ...base, refund_eligible: false }), ftTerms, "client.test.near", NOW)).not.toContain("refund");
    expect(actionsFor(info({ ...base, refund_eligible: true }), ftTerms, "client.test.near", NOW)).toContain("refund");
    expect(actionsFor(info({ ...base, refund_eligible: true }), ftTerms, "stranger.test.near", NOW)).not.toContain("refund");
  });

  it("actions follow status, role and the review window", () => {
    const client = "client.test.near";
    expect(actionsFor(info(), ftTerms, client, NOW)).toEqual(["fund"]);
    expect(actionsFor(info(), ftTerms, "someone.else.near", NOW)).toEqual([]); // named client only
    expect(actionsFor(info(), { ...ftTerms, client: null }, "someone.else.near", NOW)).toEqual(["fund"]);
    expect(actionsFor(info(), ftTerms, "artist.test.near", NOW)).toEqual(["cancel_offer"]); // review minor 13
    const open = info({ status: "Delivered", owner: client, review_ends_at: ns(NOW + DAY_MS) });
    expect(actionsFor(open, ftTerms, client, NOW)).toEqual(expect.arrayContaining(["accept", "request_changes", "reject"]));
    const lapsed = info({ status: "Delivered", owner: client, review_ends_at: ns(NOW - 1) });
    expect(actionsFor(lapsed, ftTerms, client, NOW)).not.toContain("reject");
    expect(actionsFor(lapsed, ftTerms, "anyone.near", NOW)).toContain("settle");
    expect(actionsFor(info({ status: "Delivered", owner: client, review_ends_at: ns(NOW + DAY_MS), revisions_used: 2 }), ftTerms, client, NOW)).not.toContain("request_changes");
    expect(actionsFor(info({ status: "InProgress", owner: client }), ftTerms, client, NOW)).toEqual(expect.arrayContaining(["challenge", "release_milestone"]));
    expect(actionsFor(info({ status: "Disputed", owner: client }), ftTerms, client, NOW)).toContain("propose_split");
  });

  it("arbitrators decide only in their own stage; anyone closes a timed-out dispute", () => {
    const d = (stage: string) => info({ status: "Disputed", owner: "client.test.near", dispute_stage: stage });
    expect(actionsFor(d("Arbitrator"), ftTerms, "arb.test.near", NOW)).toEqual(["resolve"]);
    expect(actionsFor(d("Arbitrator"), ftTerms, "fallback.test.near", NOW)).toEqual([]);
    expect(actionsFor(d("Fallback"), ftTerms, "fallback.test.near", NOW)).toEqual(["resolve"]);
    expect(actionsFor(d("Negotiation"), ftTerms, "arb.test.near", NOW)).toEqual([]);
    expect(actionsFor(d("TimedOut"), ftTerms, "anyone.near", NOW)).toEqual(["timeout_resolve"]);
  });

  it("concurrent_accept_reject_shows_chain_result: a lost race is explained with the chain's status", () => {
    const m = explainRace(new ChainError("ERR_WRONG_STATUS"), info({ status: "Settled" }));
    expect(m).toBe("Someone else acted first: the piece is now complete. Your step was not applied, and any amount you sent was returned.");
    expect(explainRace(new ChainError("ERR_WRONG_STATUS"), info({ status: "Disputed" }))).toMatch(/now in dispute/);
    expect(explainRace(new Error("boom"), info())).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64 } from "@soulprint/proof";
import { DAY, HOUR, defaultOffer, offerToTerms, termsHash, validateOffer } from "../lib/terms.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../contracts/common/test-vectors/terms.json", import.meta.url), "utf8")).vectors;

describe("terms", () => {
  it("offer_defaults_match_spec", () => {
    const o = defaultOffer({ now: 0, currency: { Ft: "usdc.test.near" }, decimals: 6 });
    expect(o.graceNs).toBe(48n * HOUR); // DESIGN §6: grace 48h
    expect(o.reviewWindowNs).toBe(7n * DAY); // review window 7 days
    expect(o.revisionRounds).toBe(2);
    expect(o.timeoutArtistBps).toBe(7500); // A22, confirmed
    expect(o.rejectBondBps).toBe(500);
    expect(o.royaltyBps).toBe(500); // 5%, confirmed
    expect(o.milestones.reduce((a, m) => a + m, 0)).toBe(10_000);
  });

  it("terms_hash_shown_equals_contract_terms_hash", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(2);
    for (const v of vectors) expect(b64.encode(termsHash(v.terms))).toBe(v.hash);
  });

  it("offerToTerms round-trips into the contract JSON shape", () => {
    const o = { ...defaultOffer({ now: 1_000, currency: "Near", decimals: 24 }), price: 5n * 10n ** 24n, arbitrator: "arb.test.near", fallbackArbitrator: "fb.test.near", client: "client.test.near" };
    const t = offerToTerms(o);
    expect(t.price).toBe("5000000000000000000000000");
    expect(t.currency).toBe("Near");
    expect(typeof t.deadline_ns).toBe("string");
    expect(validateOffer(o, "artist.test.near")).toEqual([]);
    expect(validateOffer({ ...o, arbitrator: "artist.test.near" }, "artist.test.near")).toContain("The arbitrators must be someone other than you and the client.");
    expect(validateOffer({ ...o, currency: { Ft: "usdc" }, rejectBondBps: 0 }, "artist.test.near")).toContain("A refusal deposit above zero is needed when paying in USDC.");
  });
});

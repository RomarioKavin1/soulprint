import { describe, expect, it } from "vitest";
import { BADGE_TEXT, DECLARED_TEXT, levelSentence } from "../lib/wording.ts";
import { displayLevel, proofModel, showBadge } from "../lib/proof.ts";

const capture = { coverage: 0.94, activeBand: "20–30h", spanDays: 9, source: "camera" as const };

describe("proof page", () => {
  it("wording_matches_level_table (DESIGN §5)", () => {
    expect(levelSentence(0, null)).toBe("Declared by the artist");
    expect(DECLARED_TEXT).toBe("Declared by the artist");
    expect(levelSentence(2, capture)).toBe("Recorded while made: 94% built up on camera, 20–30h over 9 days");
    expect(levelSentence(3, capture, [{ result: "passed", issuerClass: "Client" }, { result: "passed", issuerClass: "Client" }])).toBe(
      "Recorded while made: 94% built up on camera, 20–30h over 9 days, and passed 2 live checks requested by the client",
    );
    expect(levelSentence(3, capture, [{ result: "passed", issuerClass: "Invited" }])).toMatch(/requested by an account the artist invited$/);
    expect(BADGE_TEXT).toBe("Commissioned and accepted");
    for (const l of [0, 2, 3] as const) expect(levelSentence(l, capture, [{ result: "passed", issuerClass: "Client" }])).not.toMatch(/not AI|proven|proof that/i);
  });

  it("badge_only_when_settled_by_commission", () => {
    const base = { mode: "Commission", status: "Settled", commissioned_badge: true } as any;
    expect(showBadge(base)).toBe(true);
    for (const status of ["Disputed", "Refunded", "Delivered", "InProgress", "Cancelled"]) expect(showBadge({ ...base, status })).toBe(false);
    expect(showBadge({ ...base, mode: "Standalone" })).toBe(false);
    expect(showBadge({ ...base, commissioned_badge: false })).toBe(false); // A29: price/challenger rules on chain
  });

  it("revoked_key_downgrades_display", () => {
    const att = { evidence_level: 3, key_id: 1, report_hash: "H" };
    expect(displayLevel(att, [], "H", "H")).toEqual({ level: 3, note: null });
    const r = displayLevel(att, [1], "H", "H");
    expect(r.level).toBe(0);
    expect(r.note).toMatch(/key .*withdrawn/i);
    const m = displayLevel(att, [], "H", "X");
    expect(m.level).toBe(0);
    expect(m.note).toMatch(/does not match/);
    expect(displayLevel({ evidence_level: 2, key_id: 1, report_hash: "OLD" }, [], "NEW", "NEW").level).toBe(0); // attestation for another report
  });

  it("price_never_rendered: the page model carries no price", () => {
    const m = proofModel({ piece: { price: "123456789", mode: "Commission", status: "Settled", commissioned_badge: true, grant: { kind: "Personal", attribution: true, transferable: true }, royalty_bps: 500, artist: "a", owner: "b", piece_id: "p1.x", token_id: "1" } as any });
    expect(JSON.stringify(m)).not.toMatch(/123456789|price/i);
  });
});

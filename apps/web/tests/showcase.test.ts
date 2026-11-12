import { describe, expect, it } from "vitest";
import { cardSentence, coverUrl, tokenOf, type GalleryPiece } from "../lib/gallery.ts";
import { tipCalls, tipMemo } from "../lib/tip.ts";
import type { ChainView } from "../lib/near.ts";

const base: GalleryPiece = {
  pieceId: "p7.soulprint.test.near", artist: "artist.test.near", level: 0, publishedAt: 1, capture: null,
  challengesPassed: 0, publicFrames: 0, cover: null, story: null,
};
const cap = { coverage: 0.94, activeBand: "20–30h", sessions: 4, spanDays: 9, source: "camera" as const };

describe("gallery cards", () => {
  it("say only what the record shows, in the proof page's words", () => {
    expect(cardSentence(base)).toBe("Declared by the artist");
    expect(cardSentence({ ...base, level: 0, capture: cap })).toBe("Declared by the artist");
    expect(cardSentence({ ...base, level: 2, capture: cap })).toBe("Recorded while made: 94% built up on camera, 20–30h over 9 days");
    expect(cardSentence({ ...base, level: 3, capture: cap, challengesPassed: 2 })).toBe("Recorded while made: 94% built up on camera, 20–30h over 9 days, and passed 2 live checks");
    expect(cardSentence({ ...base, level: 3, capture: cap, challengesPassed: 1 })).toMatch(/passed 1 live check$/);
  });
  it("cover comes from the public frame route; no cover when nothing is public", () => {
    expect(coverUrl(base)).toBeNull();
    expect(coverUrl({ ...base, cover: { key: "ed25519:abc", index: 4 } })).toBe("/evidence/pieces/p7.soulprint.test.near/frames/ed25519%3Aabc/4");
    expect(tokenOf("p12.soulprint-v1.x.testnet")).toBe("12");
  });
});

function fakeChain(registered: boolean): ChainView {
  return {
    view: async (_c: string, method: string) => (method === "storage_balance_of" ? (registered ? { total: "1", available: "0" } : null) : { min: "1250000000000000000000" }),
  } as unknown as ChainView;
}

describe("tips", () => {
  it("go straight to the artist with the piece in the memo", async () => {
    const calls = await tipCalls(fakeChain(true), "usdc.test.near", "artist.test.near", 2_000_000n, "p7.soulprint.test.near");
    expect(calls).toEqual([
      { contract: "usdc.test.near", method: "ft_transfer", args: { receiver_id: "artist.test.near", amount: "2000000", memo: tipMemo("p7.soulprint.test.near") }, deposit: 1n, tgas: 30n },
    ]);
  });
  it("register the artist with the token first when needed (the tipper pays the storage)", async () => {
    const calls = await tipCalls(fakeChain(false), "usdc.test.near", "artist.test.near", 1n, "p7.soulprint.test.near");
    expect(calls.map((c) => c.method)).toEqual(["storage_deposit", "ft_transfer"]);
    expect(calls[0]!.deposit).toBe(1_250_000_000_000_000_000_000n);
  });
  it("refuse zero", async () => {
    await expect(tipCalls(fakeChain(true), "u", "a", 0n, "p")).rejects.toThrow("ERR_WRONG_AMOUNT");
  });
});

describe("reader notes wording", async () => {
  const { addedSince, ratingLine, CONCERN_TEXT } = await import("../lib/context-notes.ts");
  const note = { id: 1, pieceId: "p1", author: "a", concern: "ai_generated" as const, body: "", asksEvidence: true, createdAt: 0, status: "needs_ratings" as const, ratings: { helpful: 0, total: 0 }, publicFramesAtNote: 2, response: null };
  it("says where a note stands, in counts", () => {
    expect(ratingLine(note)).toBe("No ratings yet");
    expect(ratingLine({ ...note, ratings: { helpful: 1, total: 2 } })).toBe("2 ratings so far — needs more before it is shown");
    expect(ratingLine({ status: "shown", ratings: { helpful: 2, total: 3 } })).toBe("Rated helpful by 2 of 3 people");
    expect(ratingLine({ status: "not_shown", ratings: { helpful: 1, total: 4 } })).toBe("Rated not helpful by 3 of 4 people");
  });
  it("credits evidence the artist added after the note", () => {
    expect(addedSince(note)).toBeNull();
    expect(addedSince({ ...note, response: { body: "x", at: 0, publicFramesAtResponse: 2 } })).toBeNull();
    expect(addedSince({ ...note, response: { body: "x", at: 0, publicFramesAtResponse: 6 } })).toBe("Since this note, the artist made 4 more frames of the making public.");
  });
  it("never calls anything fake", () => {
    expect(Object.values(CONCERN_TEXT).join(" ")).not.toMatch(/fake|fraud|cheat/i);
  });
});

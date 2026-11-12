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

describe("reader questions wording", async () => {
  const { requestLine, ratingLine, galleryBadge, CONCERN_TEXT, CONCERN_QUESTION, REQUEST_TEXT } = await import("../lib/context-notes.ts");
  const { parseTip } = await import("../lib/tip.ts");
  const note = { id: 1, pieceId: "p1", artist: "a", author: "r", concern: "ai_generated" as const, body: "", request: "more_frames" as const, requestMet: false,
    createdAt: 0, status: "needs_ratings" as const, ratings: { helpful: 0, total: 0 }, publicFramesAtNote: 2, publicFramesNow: 2, response: null };
  it("a shown question reads as readers finding a question useful, never as a verdict", () => {
    expect(ratingLine(note)).toBe("No ratings yet — not shown to visitors");
    expect(ratingLine({ ...note, ratings: { helpful: 1, total: 2 } })).toBe("2 ratings so far — not shown to visitors yet");
    expect(ratingLine({ status: "shown", ratings: { helpful: 4, total: 5 } })).toBe("4 of 5 readers found this question useful");
    expect(ratingLine({ status: "disagree", ratings: { helpful: 3, total: 6 } })).toBe("Readers disagree (3 of 6 found it useful) — not shown to visitors");
    expect(CONCERN_QUESTION.ai_generated).toBe("Could this have been made with AI?");
  });
  it("a request resolves from the record, or waits for the artist", () => {
    expect(requestLine({ ...note, request: "none" })).toBeNull();
    expect(requestLine(note)).toEqual({ met: false, text: "Asked for more frames of the making. Waiting for the artist." });
    expect(requestLine({ ...note, requestMet: true, publicFramesNow: 6 })).toEqual({ met: true, text: "Asked for more frames of the making. The artist made 4 more frames public." });
    expect(requestLine({ ...note, request: "photo", requestMet: null, response: { body: "x", at: 0, publicFramesAtResponse: 2 } })!.text).toBe("Asked for a photo of the physical work. The artist answered below.");
  });
  it("the gallery badge is neutral and says when the artist answered", () => {
    expect(galleryBadge(undefined)).toBeNull();
    expect(galleryBadge({ shown: 0, answered: 0 })).toBeNull();
    expect(galleryBadge({ shown: 1, answered: 0 })).toBe("A reader asked a question");
    expect(galleryBadge({ shown: 1, answered: 1 })).toBe("The artist answered a reader's question");
  });
  it("never calls anything fake", () => {
    expect(JSON.stringify([CONCERN_TEXT, CONCERN_QUESTION, REQUEST_TEXT])).not.toMatch(/fake|fraud|cheat|scam/i);
  });
  it("tips must be a positive amount the token can hold (review B6)", () => {
    expect([parseTip("1.5", 6), parseTip("0", 6), parseTip("-1", 6), parseTip("0.0000001", 6), parseTip("abc", 6), parseTip("", 6), parseTip("0.000001", 6)])
      .toEqual([1_500_000n, null, null, null, null, null, 1n]);
  });
});

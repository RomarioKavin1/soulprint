/** Deferred minors from the Plan 3 review (web), each pinned by a test. */
import { describe, expect, it } from "vitest";
import { money } from "../lib/money.ts";
import { tokenOf, canRecord, actionsFor, extendDeadlineNs } from "../lib/commission.ts";
import { historyNotice, lagNotice } from "../lib/history.ts";
import { publicDemoAccounts } from "../lib/demo.ts";
import { chainErrorCode } from "../lib/near.ts";

describe("web minors", () => {
  it("4: the piece's own token is used, not the configured one", () => {
    expect(tokenOf({ Ft: "other-usd.near" })).toBe("other-usd.near");
    expect(tokenOf("Near")).toBeNull();
  });
  it("8: amounts are not truncated", () => {
    expect(money("1255000", { Ft: "u" }, 6)).toBe("1.255 USDC");
    expect(money("1000001", { Ft: "u" }, 6)).toBe("1.000001 USDC");
    expect(money(1_234_567_000_000_000_000_000_000n, "Near", 24)).toBe("1.234567 NEAR");
    expect(money("25000000", { Ft: "u" }, 6)).toBe("25 USDC");
  });
  it("9: history says when it could not refresh, and when nothing is indexed yet", () => {
    expect(historyNotice({ hasData: true, refreshFailed: true })).toMatch(/could not be refreshed/);
    expect(historyNotice({ hasData: true, refreshFailed: false })).toBeNull();
    expect(lagNotice({ updating: false, behindMs: 0, indexedHeight: 0 })).toMatch(/still being loaded/);
  });
  it("10: service keys never reach the browser", () => {
    const all = ["governance", "relayer", "artist", "client"].map((role) => ({ role, accountId: `${role}.near`, secretKey: "k" }));
    expect(publicDemoAccounts(all).map((a) => a.role)).toEqual(["artist", "client"]);
  });
  it("12: not enough NEAR for a step is named, not 'refused'", () => {
    expect(chainErrorCode({ ActionError: { kind: { LackBalanceForState: { account_id: "x", amount: "1" } } } })).toBe("ERR_NO_NEAR");
    expect(chainErrorCode(new Error('{"InvalidTxError":{"NotEnoughBalance":{"signer_id":"x"}}}'))).toBe("ERR_NO_NEAR");
  });
  it("7: recording is offered exactly where the evidence service accepts frames", () => {
    for (const s of ["Offered", "InProgress"]) expect(canRecord({ status: s } as any)).toBe(true);
    for (const s of ["Delivered", "Disputed", "Settled", "Refunded", "Cancelled"]) expect(canRecord({ status: s } as any)).toBe(false);
  });
  it("13: cancel an unpaid offer, agree a new deadline, propose and accept wider rights", () => {
    const t = { client: "client.near", milestones: [{ bps: 10000 }], revision_rounds: 2 } as any;
    const base = { mode: "Commission", artist: "artist.near", owner: "artist.near", status: "Offered", released_milestones: 0, split: null, refund_eligible: false, review_ends_at: null, pending_addendum: null } as any;
    expect(actionsFor(base, t, "artist.near", 0)).toContain("cancel_offer");
    const working = { ...base, status: "InProgress", owner: "client.near" };
    expect(actionsFor(working, t, "artist.near", 0)).toContain("extend");
    expect(actionsFor(working, t, "client.near", 0)).toContain("extend");
    const settled = { ...base, status: "Settled", owner: "client.near" };
    expect(actionsFor(settled, t, "artist.near", 0)).toContain("propose_addendum");
    expect(actionsFor({ ...settled, pending_addendum: { grant: {}, text_hash: "h" } }, t, "client.near", 0)).toContain("accept_addendum");
    expect(actionsFor(settled, t, "client.near", 0)).not.toContain("accept_addendum");
    // Both parties picking the same date produce the same deadline.
    expect(extendDeadlineNs("2026-12-01")).toBe(extendDeadlineNs("2026-12-01"));
    expect(extendDeadlineNs("2026-12-01")).toBe(BigInt(Date.UTC(2026, 11, 1, 23, 59, 59)) * 1_000_000n);
  });
});

import { piecesFor } from "../lib/piece.ts";

describe("studio list (review minor 14)", () => {
  const info = (id: string, artist: string, owner: string) => ({ piece_id: id, artist, owner, created_at: "1" });
  it("asks the indexer which pieces to read, then reads each from the chain", async () => {
    const views: string[] = [];
    const chain = { view: async (c: string, m: string) => { views.push(`${c}.${m}`); return c === "p1.c" ? info("p1.c", "me", "x") : info("p2.c", "y", "me"); } } as any;
    const idx = async (url: string) => ({ ok: true, json: async () => ({ pieces: url.includes("/artists/") ? [{ pieceId: "p1.c" }] : [{ pieceId: "p2.c" }] }) }) as any;
    const r = await piecesFor(chain, "c", "me", idx);
    expect(r.map((p) => p.piece_id).sort()).toEqual(["p1.c", "p2.c"]);
    expect(views).not.toContain("c.nft_tokens"); // no full scan
  });
  it("falls back to scanning the collection when the indexer is down", async () => {
    const chain = { view: async (c: string, m: string) => (m === "nft_tokens" ? [{ token_id: "1", owner_id: "me" }] : info("p1.c", "me", "me")) } as any;
    const r = await piecesFor(chain, "c", "me", async () => { throw new Error("down"); });
    expect(r.map((p) => p.piece_id)).toEqual(["p1.c"]);
  });
});

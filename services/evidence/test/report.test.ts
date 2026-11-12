import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { jcs } from "../src/jcs.ts";
import { b64, hex, nobleSigner, reportMessage, segmentsDigest } from "@soulprint/proof";
import { decideLevel, signReport, type LevelInput } from "../src/report.ts";
import { THRESHOLDS } from "../src/metrics/thresholds.ts";
import { Device, nep413, PIECE, user, world } from "./helpers.ts";
import { noteStatus } from "../src/context-notes.ts";
import type { Deps } from "../src/server.ts";
import { frames as synthFrames, jpeg, painting, target } from "./synth.ts";

const pass: LevelInput = {
  anchored: true, frames: 25, coverage: 0.95, largestJump: 0.1, activeMs: 3_600_000,
  finalMatch: { ok: true, distance: 2 }, passedChallengesByOthers: 0,
};

describe("level rules (DESIGN §5, A32: E0/E2/E3)", () => {
  it("level_rules_table", () => {
    const t = THRESHOLDS.e2;
    const rows: [Partial<LevelInput>, number][] = [
      [{}, 2],
      [{ passedChallengesByOthers: 1 }, 3],
      [{ anchored: false }, 0],
      [{ coverage: t.minCoverage - 0.001 }, 0],
      [{ coverage: t.minCoverage }, 2],
      [{ largestJump: t.maxLargestJump + 0.001 }, 0],
      [{ largestJump: t.maxLargestJump }, 2],
      [{ frames: t.minFrames - 1 }, 0],
      [{ activeMs: t.minActiveMs - 1 }, 0],
      [{ finalMatch: { ok: false, distance: 30 } }, 0],
      [{ finalMatch: null }, 0],
    ];
    for (const [over, level] of rows) expect([over, decideLevel({ ...pass, ...over })]).toEqual([over, level]);
  });
  it("level_never_above_evidence", () => {
    // Passed challenges never lift a piece whose capture evidence fails E2.
    expect(decideLevel({ ...pass, coverage: 0.1, passedChallengesByOthers: 5 })).toBe(0);
    expect(decideLevel({ ...pass, anchored: false, passedChallengesByOthers: 5 })).toBe(0);
  });
});

/** Live capture: each batch reaches the service right after its last frame (`live = false`: all at once at the end). */
async function recorded(live = true, corrupt: number[] = [], over: Partial<Deps> = {}) {
  // Fake clock while frames upload (capture-key signed), real clock afterwards (NEP-413 auth checks it).
  const clock: { t: number | null } = { t: 1_700_000_000_000 };
  const w = await world({ now: () => clock.t ?? Date.now(), ...over });
  const imgs = (await synthFrames(painting())).map((f) => f.jpeg);
  // A JPEG header then garbage: hashes and chains fine, does not decode (Plan 2 review M8).
  for (const i of corrupt) imgs[i] = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0x5a), 0xff, 0xd9]);
  const dev = w.dev;
  dev.capture(imgs.length, imgs, 5 * 60_000);
  const at = (i: number) => 1_700_000_000_000 + i * 5 * 60_000 + 5_000;
  for (let i = 0; i < imgs.length; i += 10) {
    clock.t = live ? at(Math.min(i + 9, imgs.length - 1)) : at(imgs.length - 1);
    expect((await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/frames`, payload: await dev.batch(i, Math.min(i + 9, imgs.length - 1)) })).statusCode).toBe(200);
  }
  clock.t = null;
  const call = async (who: any, method: "GET" | "POST", url: string, body?: unknown) =>
    w.app.inject({ method, url, payload: body as any, headers: who ? { authorization: await nep413(who, method, url, body) } : {} });
  const final = await jpeg(target());
  return { ...w, call, final, count: imgs.length };
}
const anchorAll = (w: Awaited<ReturnType<typeof recorded>>) => {
  const p = w.chain.pieces.get(PIECE)!;
  p.anchored = new Map([[hex.encode(w.dev.signer.publicKey), { head: w.dev.frames.at(-1)!.link, count: w.count }]]);
};

describe("report", () => {
  it("a delivered report is pinned: rebuilding cannot change it, attest still works (review I2)", async () => {
    const w = await recorded();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    const rep = (await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, {})).json();
    Object.assign(w.chain.pieces.get(PIECE)!, { status: "Delivered", finalFileHash: rep.finalFileHash, reportHash: rep.reportHash });
    // Rebuilding with different inputs after delivery returns the delivered report.
    const again = (await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, { source: "camera" })).json();
    expect(again.reportHash).toBe(rep.reportHash);
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/attest`, {})).statusCode).toBe(200);
  }, 60_000);

  it("anchored means the chain holds our head, not just our count (review I2)", async () => {
    const w = await recorded();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    const a = w.chain.pieces.get(PIECE)!.anchored!.get(hex.encode(w.dev.signer.publicKey))!;
    a.head = new Uint8Array(32).fill(9); // same count, different chain
    const r = (await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, {})).json();
    expect(r.level).toBe(0);
  }, 60_000);

  it("no cadence anchor while a built report waits for delivery (review I2)", async () => {
    const w = await recorded();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, {})).statusCode).toBe(200);
    const sent = w.sender.anchors.length;
    w.dev.capture(25);
    expect((await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/frames`, payload: await w.dev.batch(w.count, w.count + 24) })).statusCode).toBe(200);
    expect(w.sender.anchors.length).toBe(sent);
  }, 60_000);
  it("an_undecodable_frame_is_skipped_and_counted_and_the_report_still_builds (review M8)", async () => {
    const w = await recorded(true, [5]);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    const r = await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().public.capture).toMatchObject({ frames: w.count - 1, undecodableFrames: 1 });
  }, 60_000);

  it("ingest_flags_undecodable_frames_without_refusing_them (review M8)", async () => {
    const w = await world();
    const ok = await (await import("./helpers.ts")).tinyImage(3);
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    w.dev.capture(3, [ok, bad, ok]);
    const r = await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/frames`, payload: await w.dev.batch(0, 2) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ stored: 3, count: 3, undecodable: [1] });
  });

  it("frames uploaded in one go cannot claim the hours their timestamps say (review C2)", async () => {
    const w = await recorded(false);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    const r = await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, {});
    expect(r.statusCode).toBe(200);
    const cap = r.json().public.capture;
    expect(cap.spanDays).toBeLessThan(0.05);
    expect(cap.timeNote).toMatch(/received/);
    expect(r.json().level).toBe(0);
  });

  it("report_hash_is_sha256_of_canonical_json and recomputable from the public report", async () => {
    const w = await recorded();
    const url = `/pieces/${PIECE}/report`;
    expect((await w.call(w.client, "POST", url, {})).statusCode).toBe(403);
    expect((await w.call(w.artist, "POST", url, {})).json().error).toBe("final_file_missing");
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    // Not everything is anchored yet: the service forces an anchor and asks to retry.
    const pending = await w.call(w.artist, "POST", url, {});
    expect(pending.json().error).toBe("anchor_pending");
    expect(w.sender.anchors.at(-1)).toMatchObject({ count: w.count });
    anchorAll(w);
    const r = await w.call(w.artist, "POST", url, {});
    expect(r.statusCode).toBe(200);
    const { public: pub, reportHash, finalFileHash, level } = r.json();
    expect(level).toBe(2);
    expect(reportHash).toBe(b64.encode(sha256(new TextEncoder().encode(jcs(pub)))));
    expect(finalFileHash).toBe(b64.encode(sha256(w.final)));
    expect(pub).toMatchObject({ version: "soulprint-report-v1", pieceId: PIECE, level: 2, thresholds: THRESHOLDS.id, verifier: "server-not-TEE" });
    expect(pub.capture.coverage).toBeGreaterThan(0.85);
    expect(pub.capture.activeBand).toBe("<5h");
    expect(JSON.stringify(pub)).not.toMatch(/price/i);
    // The report is private until published (DESIGN §1); parties can fetch it to recompute the hash.
    expect((await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/report` })).statusCode).toBe(401);
    const got = (await w.call(w.client, "GET", `/pieces/${PIECE}/report`)).json();
    expect(b64.encode(sha256(new TextEncoder().encode(jcs(got.public))))).toBe(reportHash);
  }, 60_000);

  it("signature_verifies_with_rust_vector_layout; attest after delivery; level tamper breaks the signature", async () => {
    const w = await recorded();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    const rep = (await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, {})).json();
    // Not delivered yet.
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/attest`, {})).json().error).toBe("not_delivered");
    Object.assign(w.chain.pieces.get(PIECE)!, { status: "Delivered", finalFileHash: rep.finalFileHash, reportHash: rep.reportHash });
    const r = await w.call(w.artist, "POST", `/pieces/${PIECE}/attest`, {});
    expect(r.statusCode).toBe(200);
    const args = w.sender.attests.at(-1)!;
    // issued_at is a u64 JSON number beyond 2^53: it must survive as exact text.
    const issued = /"issued_at":(\d+)/.exec(args)![1]!;
    expect(BigInt(issued)).toBeGreaterThan(10n ** 18n);
    const parsed = JSON.parse(args.replace(/"issued_at":(\d+)/, '"issued_at":"$1"'));
    expect(parsed).toMatchObject({ token_id: "1", key_id: 1 });
    const m = parsed.msg;
    const fields = {
      network: m.network, pieceId: m.piece_id, finalFileHash: b64.decode(m.final_file_hash), lastAnchorHead: b64.decode(m.last_anchor_head),
      lastAnchorCount: m.last_anchor_count, capturePubkey: b64.decode(m.capture_pubkey), evidenceLevel: m.evidence_level,
      reportHash: b64.decode(m.report_hash), issuedAt: BigInt(issued), segmentsDigest: b64.decode(m.segments_digest),
    };
    const verifier = await nobleSigner(new Uint8Array(32).fill(77));
    expect(await ed.verifyAsync(b64.decode(parsed.sig), reportMessage(fields), verifier.publicKey)).toBe(true);
    expect(await ed.verifyAsync(b64.decode(parsed.sig), reportMessage({ ...fields, evidenceLevel: 3 }), verifier.publicKey)).toBe(false);
    expect(m).toMatchObject({ domain: "soulprint-report-v1", network: "sandbox", evidence_level: 2, last_anchor_count: w.count });
    expect(b64.decode(m.segments_digest)).toEqual(segmentsDigest([{ key: w.dev.signer.publicKey, head: w.dev.frames.at(-1)!.link, count: w.count }]));
  }, 60_000);

  it("E0 uses zero anchor head and count", async () => {
    const v = await nobleSigner(new Uint8Array(32).fill(77));
    const s = await signReport(v, {
      network: "sandbox", pieceId: PIECE, finalFileHash: new Uint8Array(32).fill(1), reportHash: new Uint8Array(32).fill(2),
      level: 0, capture: null, segments: [], issuedAt: 5n,
    });
    expect(s.fields.lastAnchorCount).toBe(0);
    expect(s.fields.lastAnchorHead).toEqual(new Uint8Array(32));
  });

  it("writes the cross-language fixture used by the Rust sandbox attest test", async () => {
    // Plan 1 World: verifier seed [77;32], capture seed [42;32], first piece p1.soulprint.test.near, network "sandbox".
    const capture = await Device.make("p1.soulprint.test.near", 42);
    capture.capture(3);
    const head = capture.frames.at(-1)!.link;
    const anchorSig = await capture.signer.sign((await import("@soulprint/proof")).anchorMessage({ pieceId: "p1.soulprint.test.near", head, count: 3 }));
    const v = await nobleSigner(new Uint8Array(32).fill(77));
    const final = new Uint8Array(32).fill(0xf1), rh = new Uint8Array(32).fill(0xf2);
    const segments = [{ key: capture.signer.publicKey, head, count: 3 }];
    const e2 = await signReport(v, { network: "sandbox", pieceId: "p1.soulprint.test.near", finalFileHash: final, reportHash: rh, level: 2, capture: segments[0]!, segments, issuedAt: 1_800_000_000_000_000_000n });
    const fixture = {
      note: "Generated by services/evidence/test/report.test.ts — TS-signed report for contracts/tests attest cross-check.",
      anchor: { key: (await import("@soulprint/proof")).nearPublicKey(capture.signer.publicKey), head: b64.encode(head), count: 3, sig: b64.encode(anchorSig) },
      final_file_hash: b64.encode(final), report_hash: b64.encode(rh),
      attest_args_json: e2.argsJson("1", 1), // collection key ids start at 1
    };
    const dir = new URL("../../../contracts/tests/fixtures/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL("ts-report-e2.json", dir), JSON.stringify(fixture, null, 2) + "\n");
  });
});

describe("public proof (Plan 3 Task 4)", () => {
  async function reported() {
    const w = await recorded();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    const r = await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, { source: "camera" });
    expect(r.statusCode).toBe(200);
    return { ...w, report: r.json() };
  }

  it("private_until_published: nothing is public until the artist publishes; unpublish hides it again", async () => {
    const w = await recorded();
    const pub = () => w.app.inject({ method: "GET", url: `/pieces/${PIECE}/public` });
    expect((await pub()).statusCode).toBe(404);
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true })).json().error).toBe("no_report");
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, { source: "camera" });
    expect((await pub()).statusCode).toBe(404);
    expect((await w.call(w.client, "POST", `/pieces/${PIECE}/publish`, { published: true })).statusCode).toBe(403);
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true })).statusCode).toBe(200);
    expect((await pub()).statusCode).toBe(200);
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: false })).statusCode).toBe(200);
    expect((await pub()).statusCode).toBe(404);
  });

  it("public payload: report recomputable, only public frames, story, no price", async () => {
    const w = await reported();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/visibility`, { indices: [0, 5, 10], level: "public" });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/visibility`, { indices: [1], level: "client" });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/story`, { text: "Oil study, three sittings." });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true });
    const r = (await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/public` })).json();
    expect(b64.encode(sha256(new TextEncoder().encode(jcs(r.public))))).toBe(r.reportHash);
    expect(r.reportHash).toBe(w.report.reportHash);
    expect(r.public.capture.source).toBe("camera");
    expect(r.frames.map((f: any) => f.index)).toEqual([0, 5, 10]);
    expect(r.story).toBe("Oil study, three sittings.");
    expect(JSON.stringify(r)).not.toMatch(/price/i);
    // A public frame's image is served without sign-in; a client-only one is not.
    const key = r.frames[0].key;
    expect((await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/frames/${key}/5` })).statusCode).toBe(200);
    expect((await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/frames/${key}/1` })).statusCode).toBe(403);
  });

  it("gallery: lists only published pieces, by artist, newest public frame as cover, never the price", async () => {
    const w = await reported();
    const gallery = async (q = "") => (await w.app.inject({ method: "GET", url: `/gallery${q}` })).json().pieces;
    expect(await gallery()).toEqual([]);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/visibility`, { indices: [0, 5, 10], level: "public" });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/story`, { text: "Oil study, three sittings." });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true });
    const [g] = await gallery();
    expect(g).toMatchObject({ pieceId: PIECE, artist: w.artist.account, level: w.report.level, publicFrames: 3, cover: { index: 10 }, story: "Oil study, three sittings." });
    expect(g.capture.source).toBe("camera");
    expect(g.publishedAt).toBeGreaterThan(0);
    expect(JSON.stringify(g)).not.toMatch(/price/i);
    expect(await gallery(`?artist=${w.artist.account}`)).toHaveLength(1);
    expect(await gallery("?artist=someone.else.near")).toEqual([]);
    expect(await gallery(`?before=${g.publishedAt}`)).toEqual([]);
    // The cover is a public frame, so it loads without sign-in.
    expect((await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/frames/${g.cover.key}/${g.cover.index}` })).statusCode).toBe(200);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: false });
    expect(await gallery()).toEqual([]);
  });
});

describe("reader notes (community notes on a record)", () => {
  async function publishedPiece(over: Partial<Deps> = {}, publish = true) {
    const w = await recorded(true, [], { noteOperators: ["operator.test.near"], ...over });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "final.jpg", data: b64.encode(w.final) });
    anchorAll(w);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/report`, { source: "camera" });
    if (publish) await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true });
    const raters = await Promise.all(["r1", "r2", "r3", "r4", "r5", "r6"].map((a, i) => user(`${a}.test.near`, 60 + i, w.chain)));
    const operator = await user("operator.test.near", 70, w.chain);
    return { ...w, raters, operator };
  }
  const NOTE = { concern: "ai_generated", body: "The hands change shape between the last two public frames with no strokes in between.", request: "more_frames" };
  const get = (w: any, who: any, url: string) => w.call(who, "GET", url);
  const notesOf = async (w: any, who: any = null) => (await get(w, who, `/pieces/${PIECE}/context-notes`)).json().notes;

  it("status: showing is harder than hiding; two 'about the person' ratings hide at once", () => {
    expect([noteStatus(4, 4), noteStatus(5, 5), noteStatus(4, 5), noteStatus(3, 5), noteStatus(2, 5), noteStatus(1, 5), noteStatus(5, 5, 2), noteStatus(0, 2, 2)])
      .toEqual(["needs_ratings", "shown", "shown", "disagree", "not_shown", "not_shown", "not_shown", "not_shown"]);
  });

  it("only on published pieces; never by the artist; one per person per piece; specific enough; known request types", async () => {
    const w = await publishedPiece({}, false);
    const url = `/pieces/${PIECE}/context-notes`;
    expect((await w.call(w.stranger, "POST", url, NOTE)).json().error).toBe("not_published");
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true });
    expect((await w.call(w.artist, "POST", url, NOTE)).json().error).toBe("artist_cannot_note_own_piece");
    expect((await w.call(null, "POST", url, NOTE)).statusCode).toBe(401);
    expect((await w.call(w.stranger, "POST", url, { ...NOTE, body: "looks AI" })).json().error).toBe("note_too_short");
    expect((await w.call(w.stranger, "POST", url, { ...NOTE, concern: "fake" })).json().error).toBe("bad_concern");
    expect((await w.call(w.stranger, "POST", url, { ...NOTE, request: "dna_test" })).json().error).toBe("bad_request");
    expect((await w.call(w.stranger, "POST", url, NOTE)).statusCode).toBe(200);
    expect((await w.call(w.stranger, "POST", url, NOTE)).json().error).toBe("already_noted");
  });

  it("limits how many notes one account adds in a day", async () => {
    const w = await publishedPiece({ maxNotesPerDay: 1 });
    expect((await w.call(w.raters[0], "POST", `/pieces/${PIECE}/context-notes`, NOTE)).statusCode).toBe(200);
    const none = await publishedPiece({ maxNotesPerDay: 0 });
    const r = await none.call(none.raters[0], "POST", `/pieces/${PIECE}/context-notes`, NOTE);
    expect([r.statusCode, r.json().error]).toEqual([429, "too_many_notes"]);
  });

  it("visitors see only notes readers found useful; the queue is for signed-in raters; unpublishing hides everything (review B1, B3)", async () => {
    const w = await publishedPiece();
    const { id } = (await w.call(w.stranger, "POST", `/pieces/${PIECE}/context-notes`, NOTE)).json();
    expect(await notesOf(w)).toEqual([]); // anonymous: nothing until shown
    expect((await notesOf(w, w.raters[0])).map((n: any) => n.status)).toEqual(["needs_ratings"]);
    expect((await get(w, null, "/context-notes/needs-ratings")).statusCode).toBe(401);
    expect((await get(w, w.raters[0], "/context-notes/needs-ratings")).json().notes.map((n: any) => n.id)).toEqual([id]);
    expect((await get(w, w.stranger, "/context-notes/needs-ratings")).json().notes).toEqual([]); // own note
    expect((await get(w, w.artist, "/context-notes/needs-ratings")).json().notes).toEqual([]); // own piece
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: false });
    expect(await notesOf(w, w.raters[0])).toEqual([]);
    expect((await get(w, w.raters[0], "/context-notes/needs-ratings")).json().notes).toEqual([]);
    expect((await w.call(w.raters[0], "POST", `/context-notes/${id}/ratings`, { helpful: true, reason: "specific_details" })).json().error).toBe("not_published");
    expect((await notesOf(w, w.artist)).length).toBe(1); // the artist still sees it
  });

  it("rated into view; the artist answers and the request resolves from the record; a contested note is labelled; the level is untouched", async () => {
    const w = await publishedPiece();
    await w.call(w.artist, "POST", `/pieces/${PIECE}/visibility`, { indices: [0, 5], level: "public" });
    const levelBefore = (await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/public` })).json().public.level;
    const { id } = (await w.call(w.stranger, "POST", `/pieces/${PIECE}/context-notes`, NOTE)).json();
    const rate = (u: any, helpful: boolean, reason: string) => w.call(u, "POST", `/context-notes/${id}/ratings`, { helpful, reason });
    expect((await rate(w.stranger, true, "specific_details")).json().error).toBe("cannot_rate_own_note");
    expect((await rate(w.artist, false, "speculation")).json().error).toBe("artist_cannot_rate");
    expect((await rate(w.raters[0], true, "speculation")).json().error).toBe("bad_reason");
    for (const r of w.raters.slice(0, 3)) await rate(r, true, "specific_details");
    expect((await rate(w.raters[3], true, "names_useful_evidence")).json().status).toBe("needs_ratings"); // 4 ratings: not yet
    expect((await rate(w.raters[4], false, "speculation")).json().status).toBe("shown"); // 4 of 5
    const [shown] = await notesOf(w);
    expect(shown).toMatchObject({ status: "shown", request: "more_frames", requestMet: false, publicFramesAtNote: 2 });

    await w.call(w.artist, "POST", `/pieces/${PIECE}/visibility`, { indices: [1, 2, 3, 4], level: "public" });
    expect((await w.call(w.raters[0], "POST", `/context-notes/${id}/response`, { body: "x" })).statusCode).toBe(403);
    expect((await w.call(w.artist, "POST", `/context-notes/${id}/response`, { body: "I sketch on paper first; the early frames are public now." })).statusCode).toBe(200);
    const [answered] = await notesOf(w);
    expect(answered).toMatchObject({ requestMet: true, publicFramesNow: 6, response: { publicFramesAtResponse: 6 } });

    const g = () => w.app.inject({ method: "GET", url: "/gallery" }).then((r) => r.json().pieces[0]);
    expect((await g()).notes).toEqual({ shown: 1, answered: 1 });
    // Raters change their minds after the answer: 3 of 6 → readers disagree, not shown.
    await rate(w.raters[0], false, "artist_answered");
    await rate(w.raters[5], false, "artist_answered");
    expect((await notesOf(w, w.raters[1]))[0].status).toBe("disagree");
    expect(await notesOf(w)).toEqual([]);
    expect((await g()).notes).toEqual({ shown: 0, answered: 0 });
    expect((await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/public` })).json().public.level).toBe(levelBefore);
  });

  it("two 'about the person' ratings hide a note however many found it helpful", async () => {
    const w = await publishedPiece();
    const { id } = (await w.call(w.stranger, "POST", `/pieces/${PIECE}/context-notes`, { ...NOTE, body: "This is obviously AI. The artist is a fraud and a scammer, do not buy." })).json();
    const rate = (u: any, helpful: boolean, reason: string) => w.call(u, "POST", `/context-notes/${id}/ratings`, { helpful, reason });
    for (const r of w.raters.slice(0, 4)) await rate(r, true, "fair_tone");
    await rate(w.raters[4], false, "personal_attack");
    expect((await rate(w.raters[5], false, "personal_attack")).json().status).toBe("not_shown");
    expect(await notesOf(w)).toEqual([]);
  });

  it("the author withdraws; anyone reports; an operator removes, logged (review B2)", async () => {
    const w = await publishedPiece();
    const post = (u: any, url: string, b: unknown = {}) => w.call(u, "POST", url, b);
    const a = (await post(w.stranger, `/pieces/${PIECE}/context-notes`, NOTE)).json().id;
    expect((await post(w.raters[0], `/context-notes/${a}/withdraw`)).json().error).toBe("not_your_note");
    expect((await post(w.stranger, `/context-notes/${a}/withdraw`)).statusCode).toBe(200);
    expect(await notesOf(w, w.raters[0])).toEqual([]);
    // Withdrawing frees the slot for a better note.
    const b = (await post(w.stranger, `/pieces/${PIECE}/context-notes`, NOTE)).json().id;
    expect((await post(w.raters[0], `/context-notes/${b}/report`, { reason: "nonsense" })).json().error).toBe("bad_reason");
    expect((await post(w.raters[0], `/context-notes/${b}/report`, { reason: "personal_attack" })).statusCode).toBe(200);
    expect((await post(w.raters[1], `/context-notes/${b}/report`, { reason: "spam" })).statusCode).toBe(200);
    expect((await get(w, w.raters[0], "/context-notes/reported")).statusCode).toBe(403);
    expect((await get(w, w.operator, "/context-notes/reported")).json().notes).toMatchObject([{ id: b, reports: 2 }]);
    expect((await notesOf(w, w.operator))[0].id).toBe(b);
    expect((await get(w, w.operator, `/pieces/${PIECE}/context-notes`)).json().canModerate).toBe(true);
    expect((await post(w.raters[0], `/context-notes/${b}/remove`, { reason: "personal_attack" })).json().error).toBe("not_an_operator");
    expect((await post(w.operator, `/context-notes/${b}/remove`, { reason: "personal_attack" })).statusCode).toBe(200);
    expect(await notesOf(w, w.raters[0])).toEqual([]);
    expect((await post(w.raters[2], `/context-notes/${b}/ratings`, { helpful: true, reason: "fair_tone" })).statusCode).toBe(404);
  });

  it("the finished image: a public preview of a published piece unless the artist turns it off; a title (review B9, B10)", async () => {
    const w = await publishedPiece({}, false);
    const preview = () => w.app.inject({ method: "GET", url: `/pieces/${PIECE}/preview` });
    expect((await preview()).statusCode).toBe(404); // not published
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true, title: "  Harbour at dusk  " });
    const img = await preview();
    expect([img.statusCode, img.headers["content-type"]]).toEqual([200, "image/jpeg"]);
    const pub = (await w.app.inject({ method: "GET", url: `/pieces/${PIECE}/public` })).json();
    expect([pub.title, pub.hasPreview]).toEqual(["Harbour at dusk", true]);
    expect((await w.app.inject({ method: "GET", url: "/gallery" })).json().pieces[0]).toMatchObject({ title: "Harbour at dusk", hasPreview: true });
    expect((await get(w, w.raters[0], `/pieces/${PIECE}/publication`)).statusCode).toBe(403);
    await w.call(w.artist, "POST", `/pieces/${PIECE}/story`, { text: "Ink first." });
    await w.call(w.artist, "POST", `/pieces/${PIECE}/publish`, { published: true, showFinal: false });
    expect((await get(w, w.artist, `/pieces/${PIECE}/publication`)).json()).toEqual({ hasReport: true, published: true, title: "Harbour at dusk", showFinal: false, story: "Ink first." });
    expect((await preview()).statusCode).toBe(404);
  });
});

describe("final file upload", () => {
  it("refuses a final file that is not a readable image (instead of failing later in the report)", async () => {
    const w = await recorded();
    const bad = await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "x.png", data: b64.encode(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("not_an_image");
    expect((await w.call(w.artist, "POST", `/pieces/${PIECE}/files`, { kind: "final", name: "f.jpg", data: b64.encode(w.final) })).statusCode).toBe(200);
  });
});

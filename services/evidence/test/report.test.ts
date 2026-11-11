import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { jcs } from "../src/jcs.ts";
import { b64, hex, nobleSigner, reportMessage, segmentsDigest } from "@soulprint/proof";
import { decideLevel, signReport, type LevelInput } from "../src/report.ts";
import { THRESHOLDS } from "../src/metrics/thresholds.ts";
import { Device, nep413, PIECE, world } from "./helpers.ts";
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

async function recorded() {
  const w = await world();
  const imgs = (await synthFrames(painting())).map((f) => f.jpeg);
  const dev = w.dev;
  dev.capture(imgs.length, imgs, 5 * 60_000);
  for (let i = 0; i < imgs.length; i += 10)
    expect((await w.app.inject({ method: "POST", url: `/pieces/${PIECE}/frames`, payload: await dev.batch(i, Math.min(i + 9, imgs.length - 1)) })).statusCode).toBe(200);
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

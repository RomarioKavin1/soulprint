import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  anchorMessage, b64, batchMessage, challengeAckMessage, frameRecordHash, genesis, hex, linkHash,
  reportMessage, segmentsDigest, verifyChain, type FrameMeta,
} from "../src/index.ts";
import { sha256 } from "@noble/hashes/sha256";

const vec = (n: string) => JSON.parse(readFileSync(new URL(`../../../contracts/common/test-vectors/${n}.json`, import.meta.url), "utf8"));

describe("Rust vectors (byte-for-byte)", () => {
  it("matches_rust_genesis_vector", () => {
    const v = vec("genesis-v1");
    const g = genesis(v.piece_id, hex.decode(v.capture_pubkey_hex));
    expect(hex.encode(g)).toBe(v.genesis_hex);
    expect(hex.encode(linkHash(g, hex.decode(v.frame_hash_hex)))).toBe(v.link1_hex);
  });
  it("matches_rust_anchor_vector", () => {
    const v = vec("anchor-v1");
    const m = v.message;
    expect(hex.encode(anchorMessage({ pieceId: m.piece_id, head: b64.decode(m.head), count: m.count }))).toBe(v.borsh_hex);
  });
  it("matches_rust_batch_vector", () => {
    const v = vec("batch-v1");
    const m = v.message;
    const bytes = batchMessage({ pieceId: m.piece_id, key: b64.decode(m.key), fromIndex: m.from_index, toIndex: m.to_index, head: b64.decode(m.head) });
    expect(hex.encode(bytes)).toBe(v.borsh_hex);
  });
  it("matches_rust_challenge_ack_vector", () => {
    const v = vec("challenge-ack-v1");
    const m = v.message;
    expect(hex.encode(challengeAckMessage({ pieceId: m.piece_id, challengeId: m.challenge_id, nonceHash: b64.decode(m.nonce_hash) }))).toBe(v.borsh_hex);
  });
  it("matches_rust_report_vector", () => {
    const v = vec("report-v1");
    const m = v.message;
    const bytes = reportMessage({
      network: m.network, pieceId: m.piece_id, finalFileHash: b64.decode(m.final_file_hash),
      lastAnchorHead: b64.decode(m.last_anchor_head), lastAnchorCount: m.last_anchor_count,
      capturePubkey: b64.decode(m.capture_pubkey), evidenceLevel: m.evidence_level,
      reportHash: b64.decode(m.report_hash), issuedAt: BigInt(m.issued_at), segmentsDigest: b64.decode(m.segments_digest),
    });
    expect(hex.encode(bytes)).toBe(v.borsh_hex);
  });
  it("segments_digest_is_sha256_of_borsh_vec", () => {
    const k = new Uint8Array(32).fill(1), h = new Uint8Array(32).fill(2);
    // borsh Vec<(Bytes32, Bytes32, u32)>: u32 len, then 32 + 32 + u32 per entry.
    const raw = new Uint8Array(4 + 68);
    raw.set([1, 0, 0, 0], 0); raw.set(k, 4); raw.set(h, 36); raw.set([5, 0, 0, 0], 68);
    expect(hex.encode(segmentsDigest([{ key: k, head: h, count: 5 }]))).toBe(hex.encode(sha256(raw)));
  });
});

describe("frame chain", () => {
  const pid = "p1.soulprint.test.near";
  const pk = new Uint8Array(32).fill(3);
  const g = genesis(pid, pk);
  const build = (n: number): FrameMeta[] => {
    const out: FrameMeta[] = [];
    let prev = g;
    for (let i = 0; i < n; i++) {
      const jpegHash = sha256(new Uint8Array([i, 7, 7]));
      const deviceTs = 1_700_000_000_000 + i * 60_000;
      const link = linkHash(prev, frameRecordHash(jpegHash, i, deviceTs));
      out.push({ index: i, jpegHash, deviceTs, link });
      prev = link;
    }
    return out;
  };
  it("record hash binds index and device time", () => {
    const j = new Uint8Array(32).fill(9);
    expect(hex.encode(frameRecordHash(j, 1, 5))).not.toBe(hex.encode(frameRecordHash(j, 2, 5)));
    expect(hex.encode(frameRecordHash(j, 1, 5))).not.toBe(hex.encode(frameRecordHash(j, 1, 6)));
  });
  it("verify_chain_detects_reorder_drop_insert_tamper", () => {
    const f = build(6);
    expect(verifyChain(f, g)).toEqual({ ok: true });
    // reorder
    const r = [...f]; [r[2], r[3]] = [r[3]!, r[2]!];
    expect(verifyChain(r, g)).toEqual({ ok: false, brokenAt: 2 });
    // drop
    expect(verifyChain([...f.slice(0, 3), ...f.slice(4)], g)).toEqual({ ok: false, brokenAt: 3 });
    // insert
    const extra = build(7)[6]!;
    expect(verifyChain([...f.slice(0, 2), { ...extra, index: 2 }, ...f.slice(2)], g).ok).toBe(false);
    // tamper image hash, time, link
    expect(verifyChain(f.map((x, i) => (i === 4 ? { ...x, jpegHash: new Uint8Array(32) } : x)), g)).toEqual({ ok: false, brokenAt: 4 });
    expect(verifyChain(f.map((x, i) => (i === 1 ? { ...x, deviceTs: x.deviceTs + 1 } : x)), g)).toEqual({ ok: false, brokenAt: 1 });
    // a segment can be verified from a known head (resume after an anchor)
    expect(verifyChain(f.slice(3), f[2]!.link)).toEqual({ ok: true });
  });
});

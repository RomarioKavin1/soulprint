/** Borsh signing messages, byte-equal to `contracts/common/src/messages.rs` (vectors in test-vectors/). */
import { sha256 } from "@noble/hashes/sha256";
import { Borsh } from "./encoding.ts";

export const REPORT_DOMAIN = "soulprint-report-v1";
export const ANCHOR_DOMAIN = "soulprint-anchor-v1";
export const BATCH_DOMAIN = "soulprint-batch-v1";
export const CHALLENGE_ACK_DOMAIN = "soulprint-challenge-ack-v1";

export interface AnchorFields { pieceId: string; head: Uint8Array; count: number }
export interface BatchFields { pieceId: string; key: Uint8Array; fromIndex: number; toIndex: number; head: Uint8Array }
export interface ChallengeAckFields { pieceId: string; challengeId: number; nonceHash: Uint8Array }
export interface ReportFields {
  network: string;
  pieceId: string;
  finalFileHash: Uint8Array;
  lastAnchorHead: Uint8Array;
  lastAnchorCount: number;
  capturePubkey: Uint8Array;
  evidenceLevel: number;
  reportHash: Uint8Array;
  issuedAt: bigint;
  segmentsDigest: Uint8Array;
}
export interface Segment { key: Uint8Array; head: Uint8Array; count: number }

export const anchorMessage = (m: AnchorFields) =>
  new Borsh().string(ANCHOR_DOMAIN).string(m.pieceId).fixed(m.head, 32).u32(m.count).bytes();

export const batchMessage = (m: BatchFields) =>
  new Borsh().string(BATCH_DOMAIN).string(m.pieceId).fixed(m.key, 32).u32(m.fromIndex).u32(m.toIndex).fixed(m.head, 32).bytes();

export const challengeAckMessage = (m: ChallengeAckFields) =>
  new Borsh().string(CHALLENGE_ACK_DOMAIN).string(m.pieceId).u32(m.challengeId).fixed(m.nonceHash, 32).bytes();

export const reportMessage = (m: ReportFields) =>
  new Borsh()
    .string(REPORT_DOMAIN)
    .string(m.network)
    .string(m.pieceId)
    .fixed(m.finalFileHash, 32)
    .fixed(m.lastAnchorHead, 32)
    .u32(m.lastAnchorCount)
    .fixed(m.capturePubkey, 32)
    .u8(m.evidenceLevel)
    .fixed(m.reportHash, 32)
    .u64(m.issuedAt)
    .fixed(m.segmentsDigest, 32)
    .bytes();

/** A44: sha256(borsh(Vec<(key, head, count)>)) in key-registration order. */
export function segmentsDigest(segments: Segment[]): Uint8Array {
  const w = new Borsh().u32(segments.length);
  for (const s of segments) w.fixed(s.key, 32).fixed(s.head, 32).u32(s.count);
  return sha256(w.bytes());
}

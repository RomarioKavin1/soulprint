/**
 * Reports (DESIGN §5, A32, A36): level rules, the public report (its JCS hash is report_hash),
 * and the verifier-signed ReportMessage the collection's `attest` accepts.
 */
import { b64, nearPublicKey, reportMessage, segmentsDigest, type ReportFields, type Segment, type Signer } from "@soulprint/proof";
import { THRESHOLDS } from "./metrics/thresholds.ts";

export interface LevelInput {
  anchored: boolean;
  frames: number;
  coverage: number;
  largestJump: number;
  activeMs: number;
  finalMatch: { ok: boolean; distance: number } | null;
  passedChallengesByOthers: number;
}

/** E0 declared, E2 recorded, E3 challenged. Challenges never lift a piece that fails E2. */
export function decideLevel(i: LevelInput): 0 | 2 | 3 {
  const t = THRESHOLDS.e2;
  const e2 = i.anchored && i.frames >= t.minFrames && i.coverage >= t.minCoverage && i.largestJump <= t.maxLargestJump
    && i.activeMs >= t.minActiveMs && i.finalMatch?.ok === true;
  if (!e2) return 0;
  return i.passedChallengesByOthers > 0 ? 3 : 2;
}

export interface SignInput {
  network: string;
  pieceId: string;
  finalFileHash: Uint8Array;
  reportHash: Uint8Array;
  level: 0 | 2 | 3;
  /** The anchored segment the evidence comes from (required for E2/E3). */
  capture: Segment | null;
  /** All on-chain segments in key-registration order (A44). */
  segments: Segment[];
  /** Nanoseconds; must exceed any earlier attestation's. */
  issuedAt: bigint;
}

export async function signReport(verifier: Signer, s: SignInput) {
  if (s.level > 0 && !s.capture) throw new Error("E2/E3 needs an anchored capture segment");
  const zero = new Uint8Array(32);
  const fields: ReportFields = {
    network: s.network, pieceId: s.pieceId, finalFileHash: s.finalFileHash,
    lastAnchorHead: s.level > 0 ? s.capture!.head : zero, lastAnchorCount: s.level > 0 ? s.capture!.count : 0,
    capturePubkey: s.capture?.key ?? zero, evidenceLevel: s.level, reportHash: s.reportHash, issuedAt: s.issuedAt,
    segmentsDigest: segmentsDigest(s.segments),
  };
  const sig = await verifier.sign(reportMessage(fields));
  /**
   * `collection.attest` args. `issued_at` is a plain u64 in the contract ABI, i.e. a JSON number
   * above 2^53, so the JSON is written as text rather than through JSON.stringify.
   */
  const argsJson = (tokenId: string, keyId: number) => {
    const msg = JSON.stringify({
      domain: "soulprint-report-v1", network: fields.network, piece_id: fields.pieceId,
      final_file_hash: b64.encode(fields.finalFileHash), last_anchor_head: b64.encode(fields.lastAnchorHead),
      last_anchor_count: fields.lastAnchorCount, capture_pubkey: b64.encode(fields.capturePubkey),
      evidence_level: fields.evidenceLevel, report_hash: b64.encode(fields.reportHash), issued_at: "__ISSUED_AT__",
      segments_digest: b64.encode(fields.segmentsDigest),
    }).replace('"__ISSUED_AT__"', fields.issuedAt.toString());
    return `{"token_id":${JSON.stringify(tokenId)},"msg":${msg},"sig":${JSON.stringify(b64.encode(sig))},"key_id":${keyId}}`;
  };
  return { fields, sig, argsJson };
}

export const keyString = nearPublicKey;

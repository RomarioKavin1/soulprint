/**
 * Frame hash chain (A26, A27). Pinned to the Rust vector `genesis-v1.json`:
 *   genesis   = sha256(piece_id ‖ capture_pubkey)
 *   link_i    = sha256(link_{i-1} ‖ record_i),  link_{-1} = genesis
 *   record_i  = sha256(jpeg_sha256 ‖ u32_le(index) ‖ u64_le(device_ts_ms))
 * The record hash binds each frame's position and device time into the chain.
 */
import { sha256 } from "@noble/hashes/sha256";
import { Borsh, bytes32, concat } from "./encoding.ts";

export function genesis(pieceId: string, capturePubkey: Uint8Array): Uint8Array {
  return sha256(concat(new TextEncoder().encode(pieceId), bytes32(capturePubkey, "capture key")));
}

export function linkHash(prev: Uint8Array, record: Uint8Array): Uint8Array {
  return sha256(concat(bytes32(prev, "prev link"), bytes32(record, "record hash")));
}

export function frameRecordHash(jpegHash: Uint8Array, index: number, deviceTsMs: number): Uint8Array {
  return sha256(new Borsh().fixed(jpegHash, 32).u32(index).u64(deviceTsMs).bytes());
}

export interface FrameMeta {
  index: number;
  jpegHash: Uint8Array;
  deviceTs: number;
  link: Uint8Array;
}

/**
 * Verifies a run of consecutive frames starting from `prev` (the genesis, or a known head).
 * Indices must be consecutive from the first frame's index.
 */
export function verifyChain(frames: FrameMeta[], prev: Uint8Array): { ok: true } | { ok: false; brokenAt: number } {
  let p = prev;
  const start = frames[0]?.index ?? 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (f.index !== start + i) return { ok: false, brokenAt: i };
    const expect = linkHash(p, frameRecordHash(f.jpegHash, f.index, f.deviceTs));
    if (!eq(expect, f.link)) return { ok: false, brokenAt: i };
    p = f.link;
  }
  return { ok: true };
}

export function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** A33: `p7.soulprint-v1.x.testnet` → token id `"7"`. */
export function tokenIdOf(pieceId: string): string {
  const m = /^p(\d+)\./.exec(pieceId);
  if (!m) throw new Error(`not a piece account: ${pieceId}`);
  return m[1]!;
}

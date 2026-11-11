/** Loose final-file check (A37): perceptual difference hash distance vs the last frame. */
import sharp from "sharp";

const HW = 9, HH = 8; // 64-bit dHash

export async function dhash(img: Uint8Array): Promise<bigint> {
  const raw = await sharp(Buffer.from(img)).greyscale().resize(HW, HH, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW - 1; x++) h = (h << 1n) | (raw[y * HW + x]! > raw[y * HW + x + 1]! ? 1n : 0n);
  return h;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** Provisional (thresholds-v0-provisional) until Spike S3 calibrates: phone capture is looser. */
export const FINAL_MAX_DISTANCE = { screen: 10, camera: 18 } as const;

/** Frame → 32×32 grid of grey cell means (decoded with sharp; one frame in memory at a time). */
import sharp from "sharp";

export const GRID = 32;
const PX = 4; // pixels per cell side in the analysis image

export async function cells(jpeg: Uint8Array): Promise<Float64Array> {
  const side = GRID * PX;
  const raw = await sharp(Buffer.from(jpeg)).greyscale().resize(side, side, { fit: "fill" }).raw().toBuffer();
  const out = new Float64Array(GRID * GRID);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) out[Math.floor(y / PX) * GRID + Math.floor(x / PX)]! += raw[y * side + x]!;
  for (let i = 0; i < out.length; i++) out[i]! /= PX * PX;
  return out;
}

const SAT_LO = 6, SAT_HI = 249;

/**
 * Exposure normalisation (A37): fit b ≈ α·a + β between consecutive frames by trimmed least
 * squares over cells unsaturated in both, so the unchanged majority sets the mapping. Returns the
 * per-cell absolute difference between b and the exposure-mapped a (clamped to the sensor range).
 */
export function exposureDiff(a: Float64Array, b: Float64Array): Float64Array {
  let idx: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i]! > SAT_LO && a[i]! < SAT_HI && b[i]! > SAT_LO && b[i]! < SAT_HI) idx.push(i);
  let alpha = 1, beta = 0;
  if (idx.length >= 32) {
    const all = idx;
    for (let iter = 0; iter < 4; iter++) {
      let sa = 0, sb = 0, saa = 0, sab = 0;
      for (const i of idx) { sa += a[i]!; sb += b[i]!; saa += a[i]! * a[i]!; sab += a[i]! * b[i]!; }
      const n = idx.length, va = saa - (sa * sa) / n;
      if (va < 1e-6 * n || n < 8) { alpha = 1; beta = (sb - sa) / n; }
      else { alpha = (sab - (sa * sb) / n) / va; beta = (sb - alpha * sa) / n; }
      // Keep the 60% of cells that fit best (changes are a minority between two frames).
      const res = all.map((i) => [i, Math.abs(b[i]! - (alpha * a[i]! + beta))] as const).sort((x, y) => x[1] - y[1]);
      const cut = Math.max(4, res[Math.floor(res.length * 0.6)]![1]);
      idx = res.filter(([, r]) => r <= cut).map(([i]) => i);
    }
  } else {
    // Mostly saturated or flat: an offset is all that can be estimated.
    const d = Array.from(a, (v, i) => b[i]! - v).sort((x, y) => x - y);
    beta = d[Math.floor(d.length / 2)]!;
  }
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.abs(b[i]! - Math.min(255, Math.max(0, alpha * a[i]! + beta)));
  return out;
}

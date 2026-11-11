/** Synthetic process recordings for metric tests (Spike S3 real recordings replace these). */
import sharp from "sharp";

export const W = 320, H = 240;

/** A deterministic "finished artwork": blocks of varied grey with some gradients. */
export function target(w = W, h = H, seed = 1): Uint8Array {
  const img = new Uint8Array(w * h);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const blocks = Array.from({ length: 12 * 9 }, () => 40 + Math.floor(rnd() * 180));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) img[y * w + x] = blocks[Math.floor((y / h) * 9) * 12 + Math.floor((x / w) * 12)]! + Math.floor(((x + y) % 32) / 4);
  return img;
}

export const BLANK = 245;

/** Paint `target` in 3 passes (block-in, refine, finish); each frame paints one band of the canvas. */
export function* painting(opts: { bands?: number; region?: [number, number, number, number]; w?: number; h?: number } = {}): Generator<Uint8Array> {
  const w = opts.w ?? W, h = opts.h ?? H, bands = opts.bands ?? 8;
  const [rx0, ry0, rx1, ry1] = opts.region ?? [0, 0, 1, 1];
  const t = target(w, h);
  const canvas = new Uint8Array(w * h).fill(BLANK);
  yield canvas.slice();
  for (const amount of [0.4, 0.75, 1]) {
    for (let b = 0; b < bands; b++) {
      const y0 = Math.floor(h * (ry0 + ((ry1 - ry0) * b) / bands)), y1 = Math.floor(h * (ry0 + ((ry1 - ry0) * (b + 1)) / bands));
      for (let y = y0; y < y1; y++)
        for (let x = Math.floor(w * rx0); x < Math.floor(w * rx1); x++) canvas[y * w + x] = Math.round(BLANK + (t[y * w + x]! - BLANK) * amount);
      yield canvas.slice();
    }
  }
}

export const jpeg = (grey: Uint8Array, w = W, h = H, gain = 1) =>
  sharp(Buffer.from(grey.map((v) => Math.max(0, Math.min(255, Math.round(v * gain))))), { raw: { width: w, height: h, channels: 1 } })
    .jpeg({ quality: 85 })
    .toBuffer()
    .then((b) => new Uint8Array(b));

export async function frames(greys: Iterable<Uint8Array>, opts: { stepMs?: number; gain?: (i: number) => number; w?: number; h?: number } = {}) {
  const out: { jpeg: Uint8Array; deviceTs: number; width: number; height: number }[] = [];
  let i = 0;
  for (const g of greys) {
    const w = opts.w ?? W, h = opts.h ?? H;
    out.push({ jpeg: await jpeg(g, w, h, opts.gain?.(i) ?? 1), deviceTs: 1_700_000_000_000 + i * (opts.stepMs ?? 60_000), width: w, height: h });
    i++;
  }
  return out;
}

export async function* stream<T>(xs: T[]) {
  for (const x of xs) yield x;
}

/**
 * Process metrics (A37, A38) over a stream of frames, one decoded frame in memory at a time.
 * Frames are compared with each other (same pose), never with the final file; exposure is
 * normalised per pair; never-changing cells are excluded; a change of frame size is a
 * discontinuity (no comparison across it), not a jump.
 */
import { activity } from "./activity.ts";
import { cells, exposureDiff, GRID } from "./cells.ts";
import { dhash, FINAL_MAX_DISTANCE, hamming } from "./finalMatch.ts";

export const CHANGE_LEVEL = 6; // grey levels on a cell mean
export const BUILD_FRAMES = 3; // A37: a cell "built up" if it changed in ≥ 3 frames
export const ACTIVE_SHARE = 0.01;

export interface MetricFrame { jpeg: Uint8Array; deviceTs: number; width: number; height: number }
export interface Metrics {
  frames: number;
  coverage: number;
  largestJump: number;
  changingCells: number;
  cellMap: number[];
  changeSeries: number[];
  discontinuities: number;
  activeMs: number;
  sessions: number;
  spanDays: number;
  finalMatch: { distance: number; ok: boolean } | null;
}

export async function computeMetrics(
  frames: AsyncIterable<MetricFrame>,
  opts: { finalFile?: Uint8Array; source?: "screen" | "camera" } = {},
): Promise<Metrics> {
  const counts = new Array<number>(GRID * GRID).fill(0);
  const changedMasks: Uint8Array[] = [];
  const ts: number[] = [];
  let prev: { cells: Float64Array; w: number; h: number } | null = null;
  let last: Uint8Array | null = null;
  let discontinuities = 0;
  for await (const f of frames) {
    const c = await cells(f.jpeg);
    ts.push(f.deviceTs);
    if (prev && (prev.w !== f.width || prev.h !== f.height)) {
      discontinuities++;
      changedMasks.push(new Uint8Array(0));
    } else if (prev) {
      const d = exposureDiff(prev.cells, c);
      const mask = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) if (d[i]! > CHANGE_LEVEL) { mask[i] = 1; counts[i]!++; }
      changedMasks.push(mask);
    }
    prev = { cells: c, w: f.width, h: f.height };
    last = f.jpeg;
  }
  const changing = counts.filter((n) => n > 0).length;
  const built = counts.filter((n) => n >= BUILD_FRAMES).length;
  // Per-transition share of the changing cells (the denominator excludes never-changing cells).
  const changeSeries = changedMasks.map((m) => (changing ? m.reduce((s, v) => s + v, 0) / changing : 0));
  const largestJump = changeSeries.length ? Math.max(...changeSeries) : 0;
  const act = activity(ts, [false, ...changedMasks.map((m) => m.reduce((s, v) => s + v, 0) >= ACTIVE_SHARE * GRID * GRID)]);
  let finalMatch: Metrics["finalMatch"] = null;
  if (opts.finalFile && last) {
    const distance = hamming(await dhash(opts.finalFile), await dhash(last));
    finalMatch = { distance, ok: distance <= FINAL_MAX_DISTANCE[opts.source ?? "screen"] };
  }
  return {
    frames: ts.length, coverage: changing ? built / changing : 0, largestJump, changingCells: changing, cellMap: counts,
    changeSeries, discontinuities, ...act, finalMatch,
  };
}

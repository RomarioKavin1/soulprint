/**
 * Process metrics (A37, A38) over a stream of frames, one decoded frame in memory at a time.
 * Frames are compared with each other (same pose), never with the final file; exposure is
 * normalised per pair. Plan 2 review fixes:
 * - C1: a cell is "built up" only if it changed in ≥ 3 frames AND ended different from how it
 *   started (a hand passing over does not persist); content already present in the first frame
 *   counts in the denominator as not built. Blank background stays excluded.
 * - I1: frame size comes from the decoded image; a size change is counted and published but the
 *   pair is still compared on the analysis grid (a resize cannot hide a paste).
 * - I3: on camera, the first pair of a new session is not counted as a jump (the phone was moved);
 *   it still counts toward build-up.
 * - C2: device time is clamped to the service receive time (see `effectiveTimes`).
 */
import { activity, effectiveTimes, SESSION_GAP_MS } from "./activity.ts";
import { decode, exposureDiff, GRID } from "./cells.ts";
import { dhash, FINAL_MAX_DISTANCE, hamming } from "./finalMatch.ts";

export const CHANGE_LEVEL = 6; // grey levels on a cell mean
export const BUILD_FRAMES = 3; // A37: a cell "built up" if it changed in ≥ 3 frames
export const ACTIVE_SHARE = 0.01;

/** `width`/`height` are ignored (I1). `receivedAt` = service clock at upload (C2). */
export interface MetricFrame { jpeg: Uint8Array; deviceTs: number; width?: number; height?: number; receivedAt?: number }
export interface Metrics {
  frames: number;
  coverage: number;
  largestJump: number;
  changingCells: number;
  /** Cells already showing content in the first frame (counted as not built, C1). */
  presentAtStart: number;
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
  const jumpMasks: Uint8Array[] = [];
  const device: number[] = [], received: (number | undefined)[] = [];
  let prev: { cells: Float64Array; w: number; h: number; ts: number } | null = null;
  let first: Float64Array | null = null, lastCells: Float64Array | null = null;
  let last: Uint8Array | null = null;
  let discontinuities = 0;
  for await (const f of frames) {
    const { cells: c, width, height } = await decode(f.jpeg);
    device.push(f.deviceTs);
    received.push(f.receivedAt);
    first ??= c;
    if (prev) {
      if (prev.w !== width || prev.h !== height) discontinuities++;
      const d = exposureDiff(prev.cells, c);
      const mask = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) if (d[i]! > CHANGE_LEVEL) { mask[i] = 1; counts[i]!++; }
      changedMasks.push(mask);
      const newSession = f.deviceTs - prev.ts > SESSION_GAP_MS;
      jumpMasks.push(opts.source === "camera" && newSession ? new Uint8Array(d.length) : mask);
    }
    prev = { cells: c, w: width, h: height, ts: f.deviceTs };
    lastCells = c;
    last = f.jpeg;
  }
  // C1: persistence (first → last, exposure-normalised) and content present at the start.
  const persisted = first && lastCells ? exposureDiff(first, lastCells).map((v) => (v > CHANGE_LEVEL ? 1 : 0)) : new Float64Array(0);
  const background = first ? [...first].sort((x, y) => x - y)[Math.floor(first.length / 2)]! : 0;
  const atStart = first ? Array.from(first, (v) => Math.abs(v - background) > CHANGE_LEVEL) : [];
  const changing = counts.filter((n) => n > 0).length;
  let built = 0, denom = 0, presentAtStart = 0;
  for (let i = 0; i < counts.length; i++) {
    if (atStart[i]) presentAtStart++;
    if (counts[i]! > 0 || atStart[i]) denom++;
    if (counts[i]! >= BUILD_FRAMES && persisted[i] && !atStart[i]) built++;
  }
  // Per-transition share of the changing cells (the denominator excludes never-changing cells).
  const share = (m: Uint8Array) => (changing ? m.reduce((s, v) => s + v, 0) / changing : 0);
  const changeSeries = changedMasks.map(share);
  const jumps = jumpMasks.map(share);
  const largestJump = jumps.length ? Math.max(...jumps) : 0;
  const act = activity(effectiveTimes(device, received), [false, ...changedMasks.map((m) => m.reduce((s, v) => s + v, 0) >= ACTIVE_SHARE * GRID * GRID)]);
  let finalMatch: Metrics["finalMatch"] = null;
  if (opts.finalFile && last) {
    const distance = hamming(await dhash(opts.finalFile), await dhash(last));
    finalMatch = { distance, ok: distance <= FINAL_MAX_DISTANCE[opts.source ?? "screen"] };
  }
  return {
    frames: device.length, coverage: denom ? built / denom : 0, largestJump, changingCells: changing, presentAtStart, cellMap: counts,
    changeSeries, discontinuities, ...act, finalMatch,
  };
}

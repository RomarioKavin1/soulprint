/** A38: active time and sessions from device timestamps (bounded by on-chain anchors elsewhere). */
export const IDLE_GAP_MS = 10 * 60_000;
export const SESSION_GAP_MS = 30 * 60_000;

/** `changed[i]` = the transition (i−1 → i) changed ≥ 1% of cells; `changed[0]` is ignored. */
export function activity(ts: number[], changed: boolean[]) {
  let activeMs = 0, sessions = ts.length ? 1 : 0;
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i]! - ts[i - 1]!;
    if (gap > SESSION_GAP_MS) sessions++;
    if (changed[i] && gap > 0 && gap <= IDLE_GAP_MS) activeMs += gap;
  }
  const spanDays = ts.length ? (ts.at(-1)! - ts[0]!) / 86_400_000 : 0;
  return { activeMs, sessions, spanDays };
}

const BANDS: [number, string][] = [[5, "<5h"], [10, "5–10h"], [20, "10–20h"], [30, "20–30h"], [50, "30–50h"]];
export function band(ms: number): string {
  const h = ms / 3_600_000;
  for (const [lim, label] of BANDS) if (h < lim) return label;
  return "50h+";
}

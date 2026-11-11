/**
 * Evidence thresholds. `thresholds-v0-provisional` is set from synthetic sequences only; Spike S3
 * (5 real process recordings) replaces it with `thresholds-v1` (A37: thresholds come from S3).
 */
export const THRESHOLDS = {
  id: "thresholds-v0-provisional",
  e2: { minCoverage: 0.6, maxLargestJump: 0.3, minFrames: 12, minActiveMs: 30 * 60_000 },
} as const;

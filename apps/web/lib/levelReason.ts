/**
 * Why a record sits at its level, in plain words, from the public report alone (anyone can check it).
 * The E2 rules mirror services/evidence/src/metrics/thresholds.ts; a report names the thresholds it
 * was judged by, and unknown threshold sets fall back to a general sentence.
 */
export const E2_RULES: Record<string, { minCoverage: number; maxLargestJump: number; minFrames: number; minActiveMinutes: number }> = {
  "thresholds-v0-provisional": { minCoverage: 0.6, maxLargestJump: 0.3, minFrames: 12, minActiveMinutes: 30 },
};

export interface ReportCapture {
  frames: number;
  anchoredCount?: number;
  undecodableFrames?: number;
  coverage: number;
  largestJump: number;
  activeBand: string;
  finalMatch?: { ok: boolean } | null;
}

/** Lines explaining the level; empty when there is nothing to add. */
export function levelReasons(level: number, thresholds: string | undefined, cap: ReportCapture | null, passedByOthers: number): string[] {
  if (level === 3) return [];
  if (level === 2) return passedByOthers === 0 ? ["Not E3 because nobody else has asked for a live code that then appeared in the work."] : [];
  if (!cap) return ["E0 because no recording of the making was kept with this piece. The label says only that the artist declares it as theirs."];
  const r = thresholds ? E2_RULES[thresholds] : undefined;
  if (!r) return ["E0: this record did not meet the rules for “Recorded while made” in force when it was checked."];
  const missing: string[] = [];
  if (cap.frames === 0) missing.push("none of its frames could be measured");
  else {
    if (cap.frames < r.minFrames) missing.push(`only ${cap.frames} frames were measured (at least ${r.minFrames} are needed)`);
    if (cap.coverage < r.minCoverage) missing.push(`only ${Math.round(cap.coverage * 100)}% of the picture built up step by step (at least ${Math.round(r.minCoverage * 100)}% is needed)`);
    if (cap.largestJump > r.maxLargestJump) missing.push(`${Math.round(cap.largestJump * 100)}% of the picture changed in a single step (at most ${Math.round(r.maxLargestJump * 100)}% is allowed)`);
    if (cap.finalMatch && !cap.finalMatch.ok) missing.push("the finished file does not match the last frames of the recording");
    if (cap.finalMatch == null) missing.push("no finished file was checked against the recording");
  }
  if (missing.length === 0)
    return [`Why E0 and not “Recorded while made”: everything this report shows in detail passed, so the record fell short on a rule it states only roughly — at least ${r.minActiveMinutes} minutes of active time, with the recording anchored on-chain up to its last frame.`];
  const list = missing.length === 1 ? missing[0]! : `${missing.slice(0, -1).join("; ")}; and ${missing.at(-1)}`;
  return [`Why E0 and not “Recorded while made”: ${list}.`];
}

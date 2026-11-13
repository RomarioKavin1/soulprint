import { describe, expect, it } from "vitest";
import { levelReasons } from "../lib/levelReason.ts";

const T = "thresholds-v0-provisional";
const good = { frames: 25, coverage: 0.93, largestJump: 0.13, activeBand: "<5h", finalMatch: { ok: true } };

describe("levelReasons", () => {
  it("says nothing for E3", () => expect(levelReasons(3, T, good, 1)).toEqual([]));
  it("explains E2 without a live check", () => expect(levelReasons(2, T, good, 0)[0]).toMatch(/Not E3/));
  it("explains a missing recording", () => expect(levelReasons(0, T, null, 0)[0]).toMatch(/no recording/));
  it("names the failed rule", () => {
    expect(levelReasons(0, T, { ...good, finalMatch: { ok: false } }, 0)[0]).toMatch(/finished file does not match/);
    expect(levelReasons(0, T, { ...good, frames: 4 }, 0)[0]).toMatch(/only 4 frames/);
  });
  it("names several failures in one sentence", () => {
    const s = levelReasons(0, T, { ...good, coverage: 0.2, largestJump: 0.9 }, 0)[0]!;
    expect(s).toMatch(/only 20%/); expect(s).toMatch(/90%/); expect(s).toMatch(/; and /);
  });
  it("falls back to time when every visible rule passed", () => expect(levelReasons(0, T, good, 0)[0]).toMatch(/at least 30 minutes of active time/));
  it("handles unmeasured frames", () => expect(levelReasons(0, T, { ...good, frames: 0 }, 0)[0]).toMatch(/none of its frames/));
  it("handles unknown thresholds", () => expect(levelReasons(0, "v9", good, 0)[0]).toMatch(/did not meet/));
});

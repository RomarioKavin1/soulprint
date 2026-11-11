import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { computeMetrics } from "../src/metrics/index.ts";
import { activity } from "../src/metrics/activity.ts";
import { BLANK, frames, H, jpeg, painting, stream, target, W } from "./synth.ts";

const m = async (fs: Awaited<ReturnType<typeof frames>>, finalFile?: Uint8Array) => computeMetrics(stream(fs), { finalFile });

describe("process metrics (A37)", () => {
  it("gradual_painting_gives_high_coverage", async () => {
    const r = await m(await frames(painting()));
    expect(r.coverage).toBeGreaterThan(0.85);
    expect(r.largestJump).toBeLessThan(0.25);
    expect(r.frames).toBe(25);
    expect(r.cellMap.length).toBe(32 * 32);
  });

  it("full_image_pasted_in_one_frame_gives_jump_near_1", async () => {
    const blank = new Uint8Array(W * H).fill(BLANK);
    const t = target();
    // A few blank frames, the whole picture appears at once, then idle frames.
    const r = await m(await frames([blank, blank, blank, t, t, t, t]));
    expect(r.largestJump).toBeGreaterThan(0.9);
    expect(r.coverage).toBeLessThan(0.1);
  });

  it("trace_over_projected_image_low_coverage", async () => {
    // Painting band by band in a single pass: each cell changes once (no build-up).
    const blank = new Uint8Array(W * H).fill(BLANK), t = target();
    const seq = [blank.slice()];
    const c = blank.slice();
    for (let b = 0; b < 12; b++) {
      for (let y = Math.floor((H * b) / 12); y < Math.floor((H * (b + 1)) / 12); y++) for (let x = 0; x < W; x++) c[y * W + x] = t[y * W + x]!;
      seq.push(c.slice());
    }
    const r = await m(await frames(seq));
    expect(r.largestJump).toBeLessThan(0.2);
    expect(r.coverage).toBeLessThan(0.2);
  });

  it("blank_background_does_not_lower_coverage", async () => {
    const r = await m(await frames(painting({ region: [0.3, 0.3, 0.7, 0.7] })));
    expect(r.coverage).toBeGreaterThan(0.85);
    expect(r.changingCells).toBeLessThan(0.3 * 32 * 32);
  });

  it("exposure_normalisation_handles_brightness_shift", async () => {
    // Lighting changes twice during the session: −20% (lamp off), then +20% over the original.
    const r = await m(await frames(painting(), { gain: (i) => (i < 8 ? 1 : i < 17 ? 0.8 : 1.2) }));
    expect(r.coverage).toBeGreaterThan(0.8);
    expect(r.largestJump).toBeLessThan(0.3);
  });

  it("coverage_handles_canvas_resize", async () => {
    const before = [...painting()].slice(0, 12);
    const after = [...painting({ w: 400, h: 240 })].slice(12);
    const fs = [...(await frames(before)), ...(await frames(after, { w: 400, h: 240 }))].map((f, i) => ({ ...f, deviceTs: 1_700_000_000_000 + i * 60_000 }));
    const r = await m(fs);
    expect(r.largestJump).toBeLessThan(0.3);
    expect(r.discontinuities).toBe(1);
  });

  it("final_mismatch_detected and phone_angle_final_match_loose_check", async () => {
    const fs = await frames(painting());
    const good = await jpeg(target());
    expect((await m(fs, good)).finalMatch).toMatchObject({ ok: true });
    const other = await jpeg(target(W, H, 99));
    expect((await m(fs, other)).finalMatch).toMatchObject({ ok: false });
    // A phone photo of the screen: slightly rotated, cropped, darker. Still the same picture.
    const phone = new Uint8Array(
      await sharp(Buffer.from(target()), { raw: { width: W, height: H, channels: 1 } })
        .rotate(3, { background: { r: 200, g: 200, b: 200 } }).extract({ left: 10, top: 8, width: W - 20, height: H - 16 }).linear(0.85, 10).jpeg().toBuffer(),
    );
    expect((await computeMetrics(stream(fs), { finalFile: phone, source: "camera" })).finalMatch).toMatchObject({ ok: true });
  });
});

describe("activity (A38)", () => {
  const ts = (mins: number[]) => mins.map((x) => 1_700_000_000_000 + x * 60_000);
  it("gaps over 10 min don't count; over 30 min start a new session", () => {
    // 0..30 every minute, a 15-min gap, 45..55, a 2-hour gap, 175..185.
    const t = ts([...Array.from({ length: 31 }, (_, i) => i), ...Array.from({ length: 11 }, (_, i) => 45 + i), ...Array.from({ length: 11 }, (_, i) => 175 + i)]);
    const a = activity(t, t.map(() => true));
    expect(a.sessions).toBe(2);
    expect(a.activeMs).toBe((30 + 10 + 10) * 60_000);
  });
  it("idle frames (no change) add no active time", () => {
    const t = ts([0, 1, 2, 3, 4]);
    expect(activity(t, [true, false, false, true, true]).activeMs).toBe(2 * 60_000);
  });
  it("hours shown in bands", async () => {
    const { band } = await import("../src/metrics/activity.ts");
    expect([0, 4.9, 5, 12, 25, 31, 70].map((h) => band(h * 3_600_000))).toEqual(["<5h", "<5h", "5–10h", "10–20h", "20–30h", "30–50h", "50h+"]);
  });
});

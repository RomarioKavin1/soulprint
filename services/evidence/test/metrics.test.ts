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

describe("final-review fixes (Plan 2 review C1, C2, I1, I3)", () => {
  const t = target();
  /** Copy of `img` with a rectangle (fractions of the canvas) set to `v`. */
  const rect = (img: Uint8Array, [x0, y0, x1, y1]: number[], v: number) => {
    const out = img.slice();
    for (let y = Math.floor(H * y0!); y < Math.floor(H * y1!); y++) for (let x = Math.floor(W * x0!); x < Math.floor(W * x1!); x++) out[y * W + x] = v;
    return out;
  };

  it("finished_image_at_first_frame_low_coverage (C1)", async () => {
    // The finished picture from frame 0; a ~5% patch is nudged back and forth for 16 frames.
    const seq = [t, ...Array.from({ length: 16 }, (_, i) => rect(t, [0.4, 0.4, 0.62, 0.62], i % 2 ? 90 : 160)), t];
    const r = await m(await frames(seq, { stepMs: 180_000 }));
    expect(r.coverage).toBeLessThan(0.2);
  });

  it("transient_occlusion_not_counted (C1)", async () => {
    // A finished print with a hand moving over it; the hand leaves before the last frame.
    const seq = [t, ...Array.from({ length: 40 }, (_, i) => rect(t, [(i % 10) / 10, 0.2, (i % 10) / 10 + 0.3, 0.9], 30)), t];
    const r = await m(await frames(seq, { stepMs: 120_000 }));
    expect(r.coverage).toBeLessThan(0.2);
  });

  it("paste_with_declared_resize_is_still_a_jump (I1)", async () => {
    const blank = new Uint8Array(W * H).fill(BLANK);
    const fs = await frames([blank, blank, blank, t, t, t]);
    fs[3] = { ...fs[3]!, width: W + 1 }; // a lying client
    const r = await m(fs);
    expect(r.largestJump).toBeGreaterThan(0.9);
    expect(r.coverage).toBeLessThan(0.1);
  });

  it("lamp_on_with_clipped_highlights_is_not_a_jump (I3)", async () => {
    // Most of the canvas is still near white when a +20% lamp comes on: highlights clip.
    const r = await m(await frames(painting(), { gain: (i) => (i < 4 ? 1 : 1.2) }));
    expect(r.largestJump).toBeLessThan(0.3);
  });

  it("device time is clamped to the service receive time (C2)", async () => {
    // 25 frames uploaded in one go with invented timestamps spread over 8 days.
    const fs = (await frames(painting(), { stepMs: 8 * 3_600_000 })).map((f) => ({ ...f, receivedAt: 1_700_000_000_000 + 60_000 }));
    const r = await m(fs);
    expect(r.spanDays).toBeLessThan(0.01);
    expect(r.sessions).toBe(1);
    expect(r.activeMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it("camera_moved_between_sessions_is_not_a_jump (I3)", async () => {
    // A phone put back 2% off between two sessions (31 minutes apart), honest painting throughout.
    const shift = (g: Uint8Array, dx: number) => g.map((_, i) => g[i - dx] ?? BLANK);
    const seq = [...painting()].map((g, i) => (i < 13 ? g : shift(g, Math.round(W * 0.02))));
    const fs = (await frames(seq)).map((f, i) => ({ ...f, deviceTs: f.deviceTs + (i >= 13 ? 31 * 60_000 : 0) }));
    const cam = await computeMetrics(stream(fs), { source: "camera" });
    expect(cam.largestJump).toBeLessThan(0.3);
    // On screen capture nothing moves the "camera": the same step is still a jump.
    const scr = await computeMetrics(stream(fs), { source: "screen" });
    expect(scr.largestJump).toBeGreaterThan(0.3);
  });
});

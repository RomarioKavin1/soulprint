# Spike results

## S3 — process metrics on real recordings (PENDING)

Status: waiting for 5 real process recordings from Romario (phone-of-tablet and screen).
Until then the evidence service uses `thresholds-v0-provisional`, calibrated only on synthetic
sequences (`services/evidence/test/synth.ts`):

| Sequence (synthetic, 25 frames) | coverage | largest jump |
|---|---|---|
| 3-pass painting (block-in, refine, finish) | > 0.85 | < 0.25 |
| Same, 40% of canvas, blank background | > 0.85 | < 0.25 |
| Same, lighting steps −20% / +20% | > 0.80 | < 0.30 |
| Single-pass trace (each cell painted once) | < 0.20 | < 0.20 |
| Whole picture pasted in one frame | < 0.10 | > 0.90 |

To run S3: put recordings under `services/evidence/fixtures/s3/<name>/` (frames as JPEG with
device timestamps), run the metrics over each, record coverage / largest jump / active time /
final match here, then set `thresholds-v1` so every real recording reaches E2 and the trace and
paste sequences do not.

## S4 — challenge OCR (PENDING real photos)

Typed code rendered on a textured background: tesseract.js 7 reads `K7XQ4M` at confidence 89 in
~1.2 s (first call, includes model load). Handwritten / phone-of-tablet reliability needs 20 + 20
real frames; until measured, UI copy should suggest typing the code as a text layer when possible.
A miss is always reported as "inconclusive", never "failed".

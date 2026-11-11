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

## S4 — challenge OCR (PENDING, Task 5)

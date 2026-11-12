import { effectiveTimes, MAX_UPLOAD_LAG_MS } from "./metrics/activity.ts";
/**
 * Live challenges (A28): the issuer gets only nonce_hash = sha256(code ‖ salt) and submits
 * `issue_challenge` from their own wallet; the artist sees the code; a capture key acknowledges
 * (window starts on chain); evaluation reads frames inside the window. OCR misses are
 * "inconclusive", never "failed". Results live only in the signed report.
 */
import { createWorker, type Worker } from "tesseract.js";
import { concat } from "@soulprint/proof";
import { sha256 } from "@noble/hashes/sha256";

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const CODE_LENGTH = 6;
export const MIN_CONFIDENCE = 70;

export function newCode(): string {
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    const b = crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (b < 256 - (256 % CODE_ALPHABET.length)) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]!);
  }
  return out.join("");
}

export const nonceHashOf = (code: string, salt: Uint8Array) => sha256(concat(new TextEncoder().encode(code), salt));

export interface Ocr {
  words(jpeg: Uint8Array): Promise<{ text: string; confidence: number }[]>;
}

export class TesseractOcr implements Ocr {
  private worker: Promise<Worker> | null = null;
  constructor(private cachePath?: string) {}
  async words(jpeg: Uint8Array) {
    this.worker ??= createWorker("eng", 1, this.cachePath ? { cachePath: this.cachePath } : {});
    const r = await (await this.worker).recognize(Buffer.from(jpeg), {}, { blocks: true });
    const out: { text: string; confidence: number }[] = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) out.push({ text: w.text, confidence: w.confidence });
    return out;
  }
  async close() {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}

export type ChallengeResult = "passed" | "inconclusive" | "expired";

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** After the window, frames are still read this long to tell "expired" from "inconclusive". */
export const LATE_SCAN_MS = 30 * 60_000;

type ChallengeFrame = { jpeg: Uint8Array; deviceTs: number; receivedAt?: number };

/**
 * `ackedAt` = on-chain acknowledgement time (ms). Frames in capture order, one at a time.
 * Review C2: a frame's time is its device time clamped to the service receive time, so a frame
 * uploaded long after the window cannot pass whatever it is stamped with. Review I6: OCR runs only
 * up to `LATE_SCAN_MS` after the window.
 */
export async function evaluateChallenge(
  frames: Iterable<ChallengeFrame> | AsyncIterable<ChallengeFrame>,
  code: string,
  ackedAt: number,
  windowMs: number,
  ocr: Ocr,
): Promise<ChallengeResult> {
  const want = norm(code);
  let late = false;
  for await (const f of frames as AsyncIterable<ChallengeFrame>) {
    const t = effectiveTimes([f.deviceTs], [f.receivedAt])[0]!;
    if (t < ackedAt) continue;
    if (t >= ackedAt + windowMs + LATE_SCAN_MS) {
      // Received far too late to count; keep scanning only frames that could still be in time.
      if (f.receivedAt != null && f.receivedAt - MAX_UPLOAD_LAG_MS >= ackedAt + windowMs + LATE_SCAN_MS) {
        if (!late && (await seen(f))) late = true;
        break;
      }
      continue;
    }
    if (!(await seen(f))) continue;
    if (t < ackedAt + windowMs) return "passed";
    late = true;
  }
  return late ? "expired" : "inconclusive";

  async function seen(f: ChallengeFrame) {
    // Review M8: an image the OCR cannot read shows no code.
    const words = await ocr.words(f.jpeg).catch(() => []);
    return norm(words.filter((w) => w.confidence >= MIN_CONFIDENCE).map((w) => w.text).join("")).includes(want);
  }
}

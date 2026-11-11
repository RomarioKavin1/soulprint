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

/** `ackedAt` = on-chain acknowledgement time (ms); frames by device time, one at a time. */
export async function evaluateChallenge(
  frames: Iterable<{ jpeg: Uint8Array; deviceTs: number }> | AsyncIterable<{ jpeg: Uint8Array; deviceTs: number }>,
  code: string,
  ackedAt: number,
  windowMs: number,
  ocr: Ocr,
): Promise<ChallengeResult> {
  const want = norm(code);
  let late = false;
  for await (const f of frames as AsyncIterable<{ jpeg: Uint8Array; deviceTs: number }>) {
    if (f.deviceTs < ackedAt) continue;
    const seen = norm((await ocr.words(f.jpeg)).filter((w) => w.confidence >= MIN_CONFIDENCE).map((w) => w.text).join("")).includes(want);
    if (!seen) continue;
    if (f.deviceTs < ackedAt + windowMs) return "passed";
    late = true;
  }
  return late ? "expired" : "inconclusive";
}

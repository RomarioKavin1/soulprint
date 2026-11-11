/**
 * Capture uploads to the evidence service (Plan 2 Task 3). Batches are authenticated by the
 * capture-key signatures inside them; discards by a capture-key signature over
 * `soulprint-discard-v1:<piece>:<indices>`. No sign-in needed (a paired phone can upload).
 */
import { b64, nearPublicKey, type Signer as KeySigner } from "@soulprint/proof";
import type { UploadBatch, Uploader } from "@soulprint/proof/capture";

export class UploadError extends Error {
  constructor(public status: number, public code: string) {
    super(status === 0 ? "No connection — will retry" : `Upload refused (${code})`);
  }
}

export class HttpUploader implements Uploader {
  constructor(private base: string, private key: KeySigner, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async post(path: string, body: unknown) {
    let r: Response;
    try {
      r = await this.fetchImpl(this.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new UploadError(0, "offline");
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new UploadError(r.status, j.error ?? `http_${r.status}`);
    }
    return r.json();
  }

  async upload(b: UploadBatch): Promise<void> {
    await this.post(`/pieces/${b.pieceId}/frames`, {
      key: nearPublicKey(b.key),
      fromIndex: b.fromIndex,
      toIndex: b.toIndex,
      sig: b64.encode(b.sig),
      anchorSig: b64.encode(b.anchorSig),
      frames: b.frames.map((f) => ({
        index: f.index,
        sessionId: f.sessionId,
        deviceTs: f.deviceTs,
        jpegHash: b64.encode(f.jpegHash),
        link: b64.encode(f.link),
        jpeg: f.jpeg ? b64.encode(f.jpeg) : null,
        width: f.width,
        height: f.height,
      })),
    });
  }

  async discard(pieceId: string, key: Uint8Array, indices: number[]): Promise<void> {
    const sig = await this.key.sign(new TextEncoder().encode(`soulprint-discard-v1:${pieceId}:${indices.join(",")}`));
    await this.post(`/pieces/${pieceId}/discard`, { key: nearPublicKey(key), indices, sig: b64.encode(sig) });
  }
}

/** What the capture panel shows for a session status (Review Focus 5: no silent loss). */
export function captureStatusView(s: { capturing: boolean; paused: boolean; pending: number; uploaded: number; lastError: string | null; count: number }) {
  const waiting = s.pending > 0;
  return {
    headline: s.paused ? "Paused while this tab is hidden" : s.capturing ? "Recording" : s.count ? "Stopped" : "Not started",
    progress: `${s.uploaded} of ${s.count} frames saved to the record`,
    problem: s.lastError && waiting ? `${s.pending} frame${s.pending === 1 ? "" : "s"} not uploaded yet: ${s.lastError}` : null,
    showRetry: Boolean(s.lastError && waiting),
  };
}

/**
 * Frame sources over MediaStreams: window/screen share (`getDisplayMedia`) or the rear camera
 * pointed at a tablet (`getUserMedia`). Frames are JPEG q=0.85, long edge ≤ 1600 px.
 */
import type { FrameSource } from "./session.ts";

export const LONG_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

export class StreamSource implements FrameSource {
  private video: HTMLVideoElement;
  private ready: Promise<void>;
  constructor(private stream: MediaStream) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    this.ready = this.video.play();
  }

  async grab() {
    await this.ready;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) throw new Error("no video frame yet");
    const k = Math.min(1, LONG_EDGE / Math.max(vw, vh));
    const width = Math.round(vw * k), height = Math.round(vh * k);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(this.video, 0, 0, width, height);
    const blob = await new Promise<Blob>((ok, err) => canvas.toBlob((b) => (b ? ok(b) : err(new Error("encode failed"))), "image/jpeg", JPEG_QUALITY));
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
  }

  async stop() {
    for (const t of this.stream.getTracks()) t.stop();
  }
}

export async function screenSource(): Promise<StreamSource> {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "window" } as MediaTrackConstraints, audio: false });
  return new StreamSource(s);
}

export async function cameraSource(): Promise<StreamSource> {
  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
  return new StreamSource(s);
}

/** Default intervals (Plan 2 Task 2). */
export const INTERVAL_MS = { screen: 60_000, camera: 120_000 } as const;

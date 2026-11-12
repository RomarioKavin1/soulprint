/**
 * The showcase gallery (pivot, 12 Nov): published proof pages from the evidence service, newest
 * first. Facts only — the level, how the work built up, the artist's story. Never the price.
 */
import { DECLARED_TEXT, LEVEL_TEXT, recordedSentence, type Level } from "./wording.ts";

export interface GalleryPiece {
  pieceId: string;
  artist: string;
  level: Level;
  publishedAt: number;
  capture: { coverage: number; activeBand: string; sessions: number; spanDays: number; source?: "screen" | "camera" } | null;
  challengesPassed: number;
  publicFrames: number;
  cover: { key: string; index: number } | null;
  story: string | null;
}

/** Server side: the evidence service directly. `null` means it could not be reached (not "empty"). */
export async function loadGallery(evidenceUrl: string, q: { artist?: string; limit?: number } = {}): Promise<GalleryPiece[] | null> {
  const params = new URLSearchParams();
  if (q.artist) params.set("artist", q.artist);
  if (q.limit) params.set("limit", String(q.limit));
  try {
    const r = await fetch(`${evidenceUrl}/gallery${params.size ? `?${params}` : ""}`, { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()) as { pieces: GalleryPiece[] }).pieces;
  } catch {
    return null;
  }
}

/** "p7.soulprint.test.near" → "7". */
export function tokenOf(pieceId: string) {
  return pieceId.split(".")[0]!.replace(/^p/, "");
}

export function coverUrl(p: Pick<GalleryPiece, "pieceId" | "cover">) {
  return p.cover ? `/evidence/pieces/${p.pieceId}/frames/${encodeURIComponent(p.cover.key)}/${p.cover.index}` : null;
}

/** The card line: the same sentence the proof page leads with (challenges counted, not itemised). */
export function cardSentence(p: GalleryPiece) {
  if (p.level === 0 || !p.capture) return DECLARED_TEXT;
  const base = recordedSentence(p.capture);
  const n = p.challengesPassed;
  return p.level === 3 ? `${base}, and passed ${n} live check${n === 1 ? "" : "s"}` : base;
}

export function levelBadge(level: Level) {
  return LEVEL_TEXT[level]?.badge ?? "Declared";
}

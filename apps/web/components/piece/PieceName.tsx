"use client";
import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();

/**
 * A piece's published title, wherever the piece is named (studio, vault, buy, pay, room). Falls back to
 * the working title the artist typed on this device, then to "Piece N".
 */
export function usePieceTitle(pieceId: string): string | null {
  const [title, setTitle] = useState<string | null>(() => cache.get(pieceId) ?? working(pieceId));
  useEffect(() => {
    let alive = true;
    if (cache.has(pieceId)) { setTitle(cache.get(pieceId) ?? working(pieceId)); return; }
    fetch(`/evidence/pieces/${pieceId}/public`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { title?: string | null } | null) => {
        cache.set(pieceId, d?.title || null);
        if (alive) setTitle(d?.title || working(pieceId));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pieceId]);
  return title;
}

function working(pieceId: string): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(`soulprint.title.${pieceId}`); } catch { return null; }
}

/** "Harbour study" (or "Piece 7" when it has no title yet). */
export function PieceName({ pieceId, tokenId }: { pieceId: string; tokenId: string | number }) {
  const t = usePieceTitle(pieceId);
  return <>{t ?? `Piece ${tokenId}`}</>;
}

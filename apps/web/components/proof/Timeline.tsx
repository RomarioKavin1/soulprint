"use client";
import { useState } from "react";

interface F { key: string; index: number; deviceTs: number }

/** Scrub through the frames the artist made public. */
export function Timeline({ pieceId, frames }: { pieceId: string; frames: F[] }) {
  const [i, setI] = useState(frames.length - 1);
  if (!frames.length) return <p className="text-sm text-ink-2">The artist kept the frames private; the facts above are computed from all of them.</p>;
  const f = frames[i]!;
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-rule bg-paper-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/evidence/pieces/${pieceId}/frames/${encodeURIComponent(f.key)}/${f.index}`} alt={`Frame ${f.index + 1}`} className="mx-auto max-h-[60vh] w-auto" />
      </div>
      <input type="range" className="mt-3 w-full accent-seal" min={0} max={frames.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Timeline" />
      <p className="mt-1 text-xs text-ink-3">
        Frame {f.index + 1} · {new Date(f.deviceTs).toLocaleString()} (device clock) · {i + 1} of {frames.length} shown
      </p>
    </div>
  );
}

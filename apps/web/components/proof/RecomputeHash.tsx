"use client";
import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha256";
import { b64 } from "@soulprint/proof";
import { jcs } from "@/lib/jcs";

/** A36: anyone can recompute the report fingerprint from what this page shows. */
export function RecomputeHash({ report, onChain }: { report: unknown; onChain: string | null }) {
  const [h, setH] = useState<string | null>(null);
  useEffect(() => setH(b64.encode(sha256(new TextEncoder().encode(jcs(report))))), [report]);
  const ok = h !== null && h === onChain;
  return (
    <p className="text-sm" data-testid="recompute">
      {h === null ? (
        "Checking…"
      ) : (
        <span className="inline-flex items-start gap-2">
          <Mark ok={ok} />
          {ok ? "Recomputed in your browser: the report on this page matches the fingerprint on the piece." : "The report on this page does not match the fingerprint on the piece."}
        </span>
      )}
      <code className="mt-1 block break-all font-mono text-xs text-ink-3">{h}</code>
    </p>
  );
}

/** Drawn marks (one stroke weight) rather than glyphs. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className={`mt-0.5 shrink-0 ${ok ? "text-moss" : "text-seal"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ok ? <path d="M3 8.5l3.2 3L13 4.5" /> : <path d="M4 4l8 8M12 4l-8 8" />}
    </svg>
  );
}

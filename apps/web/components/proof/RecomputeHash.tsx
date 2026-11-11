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
      {h === null ? "Checking…" : ok ? "✓ Recomputed in your browser: the report on this page matches the fingerprint on the piece." : "✗ The report on this page does not match the fingerprint on the piece."}
      <code className="mt-1 block break-all font-mono text-xs text-ink-3">{h}</code>
    </p>
  );
}

"use client";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { attestWithRetry, useEvidence } from "@/lib/evidence";
import type { PieceInfo, ProofView } from "@/lib/piece";

/** Shown when the delivered report has not been signed onto the piece yet. */
export function AttestPanel({ piece, proof, onChange }: { piece: PieceInfo; proof: ProofView; onChange: () => void }) {
  const evidence = useEvidence();
  const { busy, error, run } = useAction();
  if (!piece.report_hash || proof.attestation.report_hash === piece.report_hash) return null;
  return (
    <Section title="Sign the record">
      <p className="text-sm text-ink-2">Your report is delivered but not yet signed onto the piece by the evidence service. Until then its public page shows it as declared.</p>
      <button className="btn-primary mt-3" disabled={!!busy} onClick={() => run("Signing", async () => { await attestWithRetry((m, p) => evidence(m, p), piece.piece_id); onChange(); })}>
        {busy ?? "Sign it now"}
      </button>
      <ErrorNote error={error} />
    </Section>
  );
}

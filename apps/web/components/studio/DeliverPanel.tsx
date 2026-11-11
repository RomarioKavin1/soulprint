"use client";
import { useEffect, useState } from "react";
import { IdbFrameStore } from "@soulprint/proof/capture";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { EvidenceError } from "@/lib/auth";
import { attestWithRetry, bytesToB64, useEvidence } from "@/lib/evidence";
import { act, type PieceInfo } from "@/lib/piece";
import { LEVEL_TEXT } from "@/lib/wording";

/** Upload the final file → build the report → deliver (commission) or settle (standalone) → attest. */
export function DeliverPanel({ piece, onChange }: { piece: PieceInfo; onChange: () => void }) {
  const { signer } = useNear();
  const evidence = useEvidence();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<"screen" | "camera">("screen");
  const [report, setReport] = useState<{ level: number; reportHash: string; finalFileHash: string } | null>(null);
  const { busy, error, run } = useAction();
  // Plan 3 review I4: frames still on this device would be missing from the record (and refused after delivery).
  const [unsent, setUnsent] = useState(0);
  useEffect(() => {
    const store = new IdbFrameStore();
    let live = true;
    const check = () => store.pendingCount(piece.piece_id).then((n) => live && setUnsent(n)).catch(() => undefined);
    void check();
    const t = setInterval(check, 5_000);
    return () => { live = false; clearInterval(t); };
  }, [piece.piece_id]);
  const commission = piece.mode === "Commission";
  const canDeliver = commission ? piece.status === "InProgress" : piece.status !== "Settled";

  async function build() {
    await run("Building the record", async () => {
      if (file) {
        const data = new Uint8Array(await file.arrayBuffer());
        await evidence("POST", `/pieces/${piece.piece_id}/files`, { kind: "final", name: file.name, data: bytesToB64(data) });
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await evidence("POST", `/pieces/${piece.piece_id}/report`, { source });
          setReport({ level: r.level, reportHash: r.reportHash, finalFileHash: r.finalFileHash });
          return;
        } catch (e) {
          if (e instanceof EvidenceError && e.code === "anchor_pending" && attempt < 20) await new Promise((r) => setTimeout(r, 2000));
          else throw e;
        }
      }
    });
  }

  async function deliver() {
    if (!report) return;
    await run("Delivering", async () => {
      const args = { final_file_hash: report.finalFileHash, report_hash: report.reportHash };
      await act(signer!, piece.piece_id, commission ? "deliver" : "settle_standalone", args);
      onChange();
      await attestWithRetry((m, p) => evidence(m, p), piece.piece_id).catch(() => undefined); // AttestPanel offers a retry
      setReport(null);
      setFile(null);
      onChange();
    });
  }

  if (!canDeliver) return null;
  return (
    <Section title={commission ? "Deliver" : "Finish the piece"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Final file</span>
          <input className="field mt-1" type="file" accept="image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        </label>
        <label className="block">
          <span className="label">Recorded with</span>
          <select className="field mt-1" value={source} onChange={(e) => setSource(e.target.value as "screen" | "camera")}>
            <option value="screen">Screen</option>
            <option value="camera">Camera</option>
          </select>
        </label>
      </div>
      {unsent > 0 && (
        <p role="status" className="mt-4 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm">
          {unsent} frame{unsent === 1 ? "" : "s"} recorded on this device {unsent === 1 ? "has" : "have"} not reached the record yet. Use “Retry upload” above, then check the record.
        </p>
      )}
      {!report ? (
        <button className="btn-primary mt-4" disabled={!!busy || !file || unsent > 0} onClick={build}>
          {busy ?? "Check the record"}
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-rule bg-paper-2/60 p-4">
          <p className="label">What the proof page will say</p>
          <p className="mt-2 font-display text-lg">{LEVEL_TEXT[report.level as 0 | 2 | 3]?.summary}</p>
          <p className="mt-1 text-sm text-ink-2">{LEVEL_TEXT[report.level as 0 | 2 | 3]?.detail}</p>
          <button className="btn-seal mt-4" disabled={!!busy || unsent > 0} onClick={deliver}>
            {busy ?? (commission ? "Deliver to the client" : "Finish and seal the record")}
          </button>
        </div>
      )}
      <ErrorNote error={error} />
    </Section>
  );
}

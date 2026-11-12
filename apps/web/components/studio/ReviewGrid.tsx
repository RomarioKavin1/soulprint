"use client";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, Section, useAction, usePoll } from "@/components/ui";
import { useEvidence, EVIDENCE_BASE } from "@/lib/evidence";
import { HttpUploader } from "@/lib/uploader";
import { loadCaptureKey } from "@/lib/keystore";
import { parseNearPublicKey } from "@soulprint/proof";

interface Frame { key: string; index: number; deviceTs: number; visibility: "private" | "client" | "public"; discarded: boolean; jpeg: string | null }
const PAGE = 60;
const VIS: Record<Frame["visibility"], string> = { private: "Only you", client: "You and the client", public: "Everyone (proof page)" };

/** Review controls only who sees each frame (A27); discarding removes the image, the chain keeps its hash. */
export function ReviewGrid({ pieceId, commission = true }: { pieceId: string; commission?: boolean }) {
  const { accountId } = useNear();
  const evidence = useEvidence();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { busy, error, run } = useAction();
  // Plan 3 review I6: page through every frame; poll only the page on screen.
  const [page, setPage] = useState(0);
  const { data, reload } = usePoll(
    () => evidence<{ total: number; frames: Frame[] }>("GET", `/pieces/${pieceId}/progress?from=${page * PAGE}&limit=${PAGE}`),
    15_000,
    [pieceId, accountId, page],
  );
  const frames = data?.frames ?? [];
  const total = data?.total ?? frames.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const id = (f: Frame) => `${f.key}#${f.index}`;
  const chosen = frames.filter((f) => sel.has(id(f)));

  async function setVisibility(level: Frame["visibility"]) {
    await run("Saving", async () => {
      const byKey = new Map<string, number[]>();
      for (const f of chosen) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f.index]);
      for (const [key, indices] of byKey) await evidence("POST", `/pieces/${pieceId}/visibility`, { key, indices, level });
      setSel(new Set());
      await reload();
    });
  }
  async function discard() {
    await run("Discarding", async () => {
      const byKey = new Map<string, number[]>();
      for (const f of chosen) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f.index]);
      for (const [key, indices] of byKey) {
        const signer = await loadCaptureKey(key);
        if (!signer) throw new Error("Frames can only be discarded from the device that recorded them.");
        await new HttpUploader(EVIDENCE_BASE, signer).discard(pieceId, parseNearPublicKey(key), indices);
      }
      setSel(new Set());
      await reload();
    });
  }

  return (
    <Section title="Review frames" aside={<span className="text-sm text-ink-3">{total} recorded</span>}>
      {frames.length === 0 ? (
        <p className="text-ink-2">Frames appear here as you record. Everything starts visible only to you.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-3">{chosen.length} selected</span>
            {commission && (
              <button className="btn-ghost py-1" disabled={!chosen.length || !!busy} onClick={() => setVisibility("client")}>
                Show to client
              </button>
            )}
            <button className="btn-ghost py-1" disabled={!chosen.length || !!busy} onClick={() => setVisibility("public")}>
              Show on proof page
            </button>
            <button className="btn-ghost py-1" disabled={!chosen.length || !!busy} onClick={() => setVisibility("private")}>
              Keep private
            </button>
            <button className="btn-ghost py-1 text-seal-2" disabled={!chosen.length || !!busy} onClick={discard}>
              Discard images
            </button>
            <button className="ml-auto text-ink-3 underline" onClick={() => setSel(new Set(frames.filter((f) => !f.discarded).map(id)))}>
              Select all on this page
            </button>
          </div>
          {pages > 1 && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <button className="btn-ghost py-1" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Earlier</button>
              <span className="text-ink-3">Frames {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
              <button className="btn-ghost py-1" disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>Later</button>
            </div>
          )}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {frames.map((f) => (
              <li key={id(f)}>
                <button
                  className={`group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border-2 ${sel.has(id(f)) ? "border-seal" : "border-transparent"} bg-paper-2`}
                  disabled={f.discarded}
                  onClick={() => setSel((s) => {
                    const n = new Set(s);
                    if (n.has(id(f))) n.delete(id(f));
                    else n.add(id(f));
                    return n;
                  })}
                  aria-label={`Frame ${f.index + 1}`}
                >
                  {f.jpeg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:image/jpeg;base64,${f.jpeg}`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-ink-3">discarded</span>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-ink/60 px-1.5 py-0.5 text-left text-[10px] text-paper">
                    #{f.index + 1} · {VIS[f.visibility]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorNote error={error} />
    </Section>
  );
}

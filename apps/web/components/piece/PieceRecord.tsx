"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { Hung, Plaque, type Moulding } from "@/components/salon/Frame";
import { fmtDate } from "@/lib/terms";

export interface PublicFrame { key: string; index: number; deviceTs: number }
export interface RecordTab { id: string; label: string; content: ReactNode }

/** Hashes from older links land on the tab that now holds them. */
const ALIASES: Record<string, string> = { verify: "record", notes: "questions" };

/**
 * The piece page as a museum object record: the work hangs large on the left; beside it, the wall
 * text, the actions, and one record read in tabs. Scrubbing the making re-hangs the picture on the
 * wall at that frame; "Back to the finished work" returns it.
 */
export function PieceRecord({ pieceId, name, artist, moulding, mat, picture, frames, header, actions, tabs, story }: {
  pieceId: string;
  name: string;
  artist: string;
  moulding: Moulding;
  mat: boolean;
  picture: { src: string; alt: string; testId?: string } | null;
  frames: PublicFrame[];
  header: ReactNode;
  actions: ReactNode;
  tabs: RecordTab[];
  story: string | null;
}) {
  const all: RecordTab[] = [{ id: "making", label: "The making", content: null }, ...tabs];
  const [tab, setTab] = useState("making");
  const [at, setAt] = useState<number | null>(null); // a frame of the making on the wall, or the finished work
  const [ar, setAr] = useState<Record<string, number>>({}); // each picture's proportions, read when it loads
  const [prev, setPrev] = useState<string | null>(null); // the picture being replaced, kept under the new one while it fades in
  const pick = (k: number | null) => { setPrev(shownSrc(at)); setAt(k); };
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      const id = ALIASES[h] ?? h;
      if (all.some((t) => t.id === id)) {
        setTab(id);
        if (h === "verify") requestAnimationFrame(() => { const d = document.getElementById("verify") as HTMLDetailsElement | null; if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } });
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useCallback((id: string, focus = false) => {
    setTab(id);
    window.history.replaceState(null, "", id === "making" ? window.location.pathname + window.location.search : `#${id}`);
    if (focus) listRef.current?.querySelector<HTMLButtonElement>(`#tab-${id}`)?.focus();
  }, []);

  const onKeys = (e: KeyboardEvent) => {
    const i = all.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    open(all[(next + all.length) % all.length]!.id, true);
  };

  const frameSrc = (fr: PublicFrame) => `/evidence/pieces/${pieceId}/frames/${encodeURIComponent(fr.key)}/${fr.index}`;
  function shownSrc(k: number | null) { return k !== null && frames[k] ? frameSrc(frames[k]!) : picture?.src ?? null; }
  const f = at !== null ? frames[at] : null;
  const shown = f ? { src: frameSrc(f), alt: `Frame ${f.index + 1} of the making of ${name}`, testId: undefined } : picture;

  return (
    <div className="piece-record">
      <div className="piece-wall">
        <div className="piece-wall-inner">
          <Hung
            moulding={moulding}
            mat={mat && !f}
            testId={shown?.testId}
            plaque={
              <Plaque
                title={name}
                line={artist}
                level={f ? `Frame ${f.index + 1} · ${fmtDate(f.deviceTs)}` : undefined}
              />
            }
          >
            {shown ? (
              <span className="piece-swap">
              {prev && prev !== shown.src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={prev} alt="" aria-hidden className="piece-swap-prev" />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={shown.src}
                src={shown.src}
                alt={shown.alt}
                className="piece-img piece-img-swap"
                style={ar[shown.src] ? ({ "--ar": ar[shown.src] } as CSSProperties) : undefined}
                ref={(i) => { if (i?.complete && i.naturalWidth && !ar[shown.src]) setAr((a) => ({ ...a, [shown.src]: i.naturalWidth / i.naturalHeight })); }}
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setAr((a) => ({ ...a, [shown.src]: i.naturalWidth / i.naturalHeight })); }}
                onAnimationEnd={() => setPrev(null)}
              />
              </span>
            ) : (
              <span className="piece-img hang-blank">The artist kept the frames private</span>
            )}
          </Hung>
          {f && (
            <button type="button" className="piece-back" onClick={() => pick(null)}>
              Back to the finished work
            </button>
          )}
        </div>
      </div>

      <div className="piece-text">
        {header}
        <div className="piece-actions">{actions}</div>

        <div className="piece-tabs" role="tablist" aria-label="About this piece" ref={listRef} onKeyDown={onKeys}>
          {all.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="piece-tab"
              onClick={() => open(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div id="panel-making" role="tabpanel" aria-labelledby="tab-making" hidden={tab !== "making"} className="piece-panel">
          {story && <blockquote className="pull-quote font-display text-[1.875rem] italic leading-snug text-ink-2">{story}</blockquote>}
          {frames.length === 0 ? (
            <p className="text-ink-2">The artist kept the frames private; the facts in The record are computed from all of them.</p>
          ) : (
            <Making frames={frames} at={at} onPick={pick} src={frameSrc} name={name} />
          )}
        </div>
        {tabs.map((t) => (
          <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id} className="piece-panel">
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The public frames as a strip and a scrubber; picking one hangs it on the wall. */
function Making({ frames, at, onPick, src, name }: { frames: PublicFrame[]; at: number | null; onPick: (i: number | null) => void; src: (f: PublicFrame) => string; name: string }) {
  const i = at ?? frames.length - 1;
  const f = frames[i]!;
  return (
    <div>
      <p className="text-ink-2">
        {frames.length} frame{frames.length === 1 ? "" : "s"} of the making {frames.length === 1 ? "is" : "are"} public. Pick one to hang it on the wall.
      </p>
      <ol className="making-strip" style={{ "--n": Math.min(frames.length, 8) } as CSSProperties}>
        {frames.map((fr, k) => (
          <li key={`${fr.key}-${fr.index}`}>
            <button
              type="button"
              className="making-thumb"
              aria-pressed={at === k}
              aria-label={`Show frame ${fr.index + 1}, ${fmtDate(fr.deviceTs)}`}
              onClick={() => onPick(at === k ? null : k)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(fr)} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ol>
      {frames.length > 1 && (
        <div className="making-line" style={{ "--n": frames.length } as CSSProperties}>
          <span className="making-ticks" aria-hidden>{frames.map((fr) => <span key={`${fr.key}-${fr.index}`} />)}</span>
          <input
            type="range"
            className="making-scrub"
            data-idle={at === null || undefined}
            min={0}
            max={frames.length - 1}
            value={i}
            onChange={(e) => onPick(Number(e.target.value))}
            aria-label="Timeline"
            aria-valuetext={`Frame ${f.index + 1}, ${fmtDate(f.deviceTs)}`}
          />
        </div>
      )}
      {at !== null && (
        // on narrow screens the wall is far above: show the picked frame where it was picked
        // eslint-disable-next-line @next/next/no-img-element
        <img className="making-preview" src={src(f)} alt={`Frame ${f.index + 1} of the making of ${name}`} />
      )}
      <p className="mt-2 text-sm text-ink-3">
        {at === null
          ? `On the wall: the finished work. The last public frame is frame ${f.index + 1}, ${fmtDate(f.deviceTs)} (device clock).`
          : `On the wall: frame ${f.index + 1}, ${fmtDate(f.deviceTs)} (device clock) · ${i + 1} of ${frames.length} public.`}
      </p>
    </div>
  );
}

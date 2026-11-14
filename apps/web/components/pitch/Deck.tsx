"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { classic, shortTitle } from "@/lib/classics";
import { Hung, Plaque, Sculpture } from "@/components/salon/Frame";

/**
 * The pitch: six slides over the Manmade wall. Arrow keys, Page Up/Down, space, Home/End and the
 * controls move between them; the slide is in the URL hash (#1–#6) so a slide can be linked.
 */
export function Deck() {
  const slides = [<Title key="t" />, <Why key="w" />, <Joke key="j" />, <Making key="m" />, <Tech key="x" />, <Flow key="f" />];
  const [i, setI] = useState(0);
  const n = slides.length;
  const go = useCallback((k: number) => setI(Math.max(0, Math.min(n - 1, k))), [n]);

  useEffect(() => {
    const read = () => {
      const h = Number(window.location.hash.slice(1));
      if (h >= 1 && h <= n) setI(h - 1);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [n]);
  useEffect(() => { window.history.replaceState(null, "", `#${i + 1}`); }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = ["ArrowRight", "PageDown", " ", "ArrowDown"].includes(e.key);
      const prev = ["ArrowLeft", "PageUp", "ArrowUp"].includes(e.key);
      if (!next && !prev && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      setI((x) => (next ? Math.min(n - 1, x + 1) : prev ? Math.max(0, x - 1) : e.key === "Home" ? 0 : n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  return (
    <div className="deck" role="region" aria-roledescription="presentation" aria-label="Manmade pitch">
      {slides.map((s, k) => (
        <section key={k} className="deck-slide" data-active={k === i || undefined} aria-hidden={k !== i} aria-roledescription="slide" aria-label={`${k + 1} of ${n}`}>
          {s}
        </section>
      ))}
      <nav className="deck-nav" aria-label="Slides">
        <button type="button" className="deck-step" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">
          <Arrow dir="left" />
        </button>
        <ol className="deck-dots">
          {slides.map((_, k) => (
            <li key={k}><button type="button" aria-label={`Slide ${k + 1}`} aria-current={k === i ? "step" : undefined} onClick={() => go(k)} /></li>
          ))}
        </ol>
        <button type="button" className="deck-step" onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Next slide">
          <Arrow dir="right" />
        </button>
        <Link href="/" className="deck-exit">Manmade<span>.works</span></Link>
      </nav>
    </div>
  );
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={dir === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
    </svg>
  );
}

/* ---------- 1. Title ---------- */
function Title() {
  const c = classic("met-436535");
  return (
    <div className="deck-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="deck-title-paint" src="/salon/hero/wheat-field-brushwork.webp" alt="" />
      <div className="deck-title-copy">
        <p className="deck-wordmark">Manmade<span>.works</span></p>
        <h1 className="deck-title-h">Real art, hung with its <em>making</em>.</h1>
        <p className="deck-title-sub">Every artwork is its own NEAR account that carries the record of how it was made.</p>
        <p className="deck-title-media">Paint, clay, photography, digital — any medium.</p>
        <p className="deck-title-meta">NEAR · NFTs That Do Something</p>
      </div>
      <div className="deck-title-whole">
        <Hung moulding="gilt-pattern" plaque={<Plaque title={shortTitle(c.title)} line={`${c.artist}, ${c.date}`} level="Example · detail behind" />}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.src} alt={`${shortTitle(c.title)} by ${c.artist}`} width={c.width} height={c.height} />
        </Hung>
      </div>
    </div>
  );
}

/* ---------- 2. Why ---------- */
function Why() {
  const s = classic("met-204812");
  return (
    <div className="deck-body deck-split">
      <div>
        <h2 className="deck-h">AI is a good tool. Slop is not <em>art</em>.</h2>
        <div className="deck-why">
          <div>
            <p className="deck-col-h">A good tool</p>
            <p>References, clean-up, ideas — in an artist&rsquo;s hands.</p>
          </div>
          <div>
            <p className="deck-col-h">Sloppy generative AI</p>
            <p>Endless images with nobody behind them.</p>
          </div>
        </div>
        <blockquote className="deck-quote">
          Art a person makes carries hours, choices and mistakes. That is its soul, and no prompt replaces it.
        </blockquote>
        <p className="deck-honest">
          Manmade can&rsquo;t stop AI images and never calls a piece &ldquo;proven not AI&rdquo;. It is our best honest attempt to show what a
          person made.
        </p>
      </div>
      <div className="deck-art">
        <Sculpture src="/salon/sculpture/met-204812.webp" alt={`${shortTitle(s.title)} by ${s.artist}`} plaque={<Plaque title={shortTitle(s.title)} line={`${s.artist}, ${s.date}`} level="Example" />} />
      </div>
    </div>
  );
}

/* ---------- 3. Our take on the "AI artist" meme ---------- */
function Joke() {
  return (
    <div className="deck-body deck-split deck-joke">
      <div>
        <h2 className="deck-h">The record doesn&rsquo;t <em>argue</em>.</h2>
        <p className="deck-honest">
          No accusations, no detectors. A piece hangs with what its record shows. Declared is not a verdict — it just means there was little making to show.
        </p>
      </div>
      <div className="joke-scene">
        <p className="joke-bubble">It took me <em>ages!</em> The prompt was forty words long.<span className="joke-who">— @golden.hours</span></p>
        <Hung
          moulding="gilt"
          plaque={<Plaque title="Golden Hour, Hand-Made" line="@golden.hours, 2026" level="Declared · 1 frame · 4 seconds" />}
        >
          <span className="joke-sunset" role="img" aria-label="A glossy, too-perfect sunset: a sun, a gradient sky and a calm sea" />
        </Hung>
        <p className="joke-note">Illustration · not a real piece</p>
      </div>
    </div>
  );
}

/* ---------- 4. The making, on record ---------- */
const STEPS: { h: string; p: string }[] = [
  { h: "Record", p: "Screen for digital work and photo editing, a camera for anything made by hand." },
  { h: "Sign", p: "Each frame is signed on the artist’s device and chained to the last." },
  { h: "Anchor", p: "The chain is written to the piece on NEAR as the work grows." },
  { h: "Check", p: "The finished work is matched to the last frames; build-up, jumps and time are measured." },
  { h: "Label", p: "Declared · Recorded while made · + live checks passed. Same words every time." },
];
function Making() {
  return (
    <div className="deck-body">
      <h2 className="deck-h">The making travels <em>with</em> the art.</h2>
      <ol className="deck-steps">
        {STEPS.map((s, k) => (
          <li key={s.h}>
            <span className="deck-step-n" aria-hidden>{["I", "II", "III", "IV", "V"][k]}</span>
            <span className="deck-step-h">{s.h}</span>
            <span className="deck-step-p">{s.p}</span>
          </li>
        ))}
      </ol>
      <div className="deck-verify">
        <Check>Anyone recomputes the record&rsquo;s fingerprint in the browser and compares it on-chain.</Check>
        <Check>People the artist invites can ask for a live code to appear in the recording.</Check>
        <Check>The artist chooses which frames are public; the facts are computed from all of them.</Check>
      </div>
    </div>
  );
}
function Check({ children }: { children: ReactNode }) {
  return (
    <p className="deck-check">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
      <span>{children}</span>
    </p>
  );
}

/* ---------- 5. Not a token: an account ---------- */
const TECH: { k: string; v: string }[] = [
  { k: "It holds the making", v: "Frame-chain anchors and a verifier-signed report; withdrawn keys downgrade old records." },
  { k: "It holds money", v: "Commission escrow: payment stages, revisions, refusal deposits, two arbitrators." },
  { k: "It pays the artist again", v: "Every sale through the piece pays the artist a royalty; licence income pools for the holder." },
  { k: "Still a standard token", v: "NEP-171 index on the collection, so standard tools can list every piece." },
];
function Tech() {
  return (
    <div className="deck-body">
      <h2 className="deck-h">Not a token.<br />An <em>account</em>.</h2>
      <div className="deck-lead">
        <p className="deck-lead-k">An account, not a pointer</p>
        <p className="deck-lead-v">Each piece is its own NEAR account, created from one shared contract by code hash. It holds what a basic NFT can only point at.</p>
      </div>
      <dl className="deck-ledger">
        {TECH.map((t) => (
          <div key={t.k}>
            <dt>{t.k}</dt>
            <dd>{t.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------- 6. How it fits together ---------- */
type Node = { id: string; x: number; y: number; w: number; h: number; t: string; s: string; main?: boolean };
const NODES: Node[] = [
  { id: "collection", x: 380, y: 0, w: 240, h: 84, t: "Collection", s: "creates pieces · NEP-171" },
  { id: "artist", x: 0, y: 210, w: 210, h: 100, t: "Artist", s: "records · signs every frame · is paid" },
  { id: "piece", x: 370, y: 190, w: 260, h: 140, t: "Piece account", s: "the making’s anchors · signed report · rights · escrow · royalty", main: true },
  { id: "people", x: 790, y: 210, w: 210, h: 100, t: "Collectors", s: "view · verify · collect · ask" },
  { id: "evidence", x: 0, y: 430, w: 210, h: 100, t: "Evidence service", s: "encrypted frames · measures" },
  { id: "indexer", x: 790, y: 430, w: 210, h: 100, t: "Indexer", s: "history and prices from events" },
];
const LINKS: { d: string; label: string; lx: number; ly: number; anchor?: "start" | "middle" | "end" }[] = [
  { d: "M500 84 L500 186", label: "creates", lx: 512, ly: 140, anchor: "start" },
  { d: "M105 310 L105 426", label: "signed frames", lx: 117, ly: 372, anchor: "start" },
  { d: "M210 470 L440 334", label: "anchors · signed report", lx: 325, ly: 407 },
  { d: "M366 260 L214 260", label: "royalty", lx: 290, ly: 248 },
  { d: "M786 260 L634 260", label: "collect", lx: 710, ly: 248 },
  { d: "M560 334 L786 470", label: "events", lx: 673, ly: 407 },
  { d: "M895 426 L895 314", label: "history · prices", lx: 883, ly: 372, anchor: "end" },
];
function Flow() {
  return (
    <div className="deck-body">
      <h2 className="deck-h">How it fits <em>together</em>.</h2>
      <figure className="deck-flow" aria-label="How Manmade's parts connect">
        <svg viewBox="0 0 1000 530" role="img" aria-labelledby="flow-desc">
          <desc id="flow-desc">
            The collection creates each piece. The artist records and signs frames and sends them to the evidence service, which anchors them and
            the signed report on the piece. Collectors view, verify and collect from the piece, which pays the artist a royalty on resale. The indexer rebuilds
            history and prices from the piece&apos;s events.
          </desc>
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {LINKS.map((l) => (
            <g key={l.label} className="flow-link">
              <path d={l.d} markerEnd="url(#flow-arrow)" />
              <text x={l.lx} y={l.ly} textAnchor={l.anchor ?? "middle"}>{l.label}</text>
            </g>
          ))}
          {NODES.map((nd) => (
            <g key={nd.id} className={nd.main ? "flow-node flow-main" : "flow-node"}>
              <rect x={nd.x} y={nd.y} width={nd.w} height={nd.h} />
              <foreignObject x={nd.x + 12} y={nd.y + 6} width={nd.w - 24} height={nd.h - 12}>
                <div className="flow-box">
                  <p className="flow-t">{nd.t}</p>
                  <p className="flow-s">{nd.s}</p>
                </div>
              </foreignObject>
            </g>
          ))}
        </svg>
        <ol className="deck-flow-list">
          <li><b>Collection</b> creates each piece (NEP-171 index).</li>
          <li><b>Artist</b> records and signs every frame; is paid a royalty on resales through the piece.</li>
          <li><b>Evidence service</b> keeps frames encrypted, measures them, and anchors them and the signed report on the piece.</li>
          <li><b>Piece account</b> holds the making&rsquo;s anchors, the report, rights, escrow and royalty.</li>
          <li><b>Collectors</b> view, verify the fingerprint, collect and ask.</li>
          <li><b>Indexer</b> rebuilds history and prices from the piece&rsquo;s events.</li>
        </ol>
      </figure>
      <p className="deck-final">Every piece keeps its making — and pays its artist again.</p>
      <p className="deck-close">Live on NEAR testnet · <a href="https://manmade.works">manmade.works</a></p>
    </div>
  );
}

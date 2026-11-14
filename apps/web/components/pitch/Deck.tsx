"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { classic, shortTitle } from "@/lib/classics";
import { Hung, Plaque } from "@/components/salon/Frame";

/**
 * The pitch: four slides over the Manmade wall. Arrow keys, Page Up/Down, space and the controls move
 * between them; the slide is in the URL hash (#1–#4) so a slide can be linked.
 */
export function Deck() {
  const slides = [<Title key="t" />, <Why key="w" />, <Making key="m" />, <Tech key="x" />];
  const [i, setI] = useState(0);
  const n = slides.length;
  const go = useCallback((k: number) => setI(Math.max(0, Math.min(n - 1, k))), [n]);

  // the slide lives in the URL hash (#1–#4), so a slide can be linked
  useEffect(() => {
    const h = Number(window.location.hash.slice(1));
    if (h >= 1 && h <= n) setI(h - 1);
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
        <section key={k} className="deck-slide" data-active={k === i || undefined} aria-hidden={k !== i} aria-roledescription="slide" aria-label={`${k + 1} of ${slides.length}`}>
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
        <button type="button" className="deck-step" onClick={() => go(i + 1)} disabled={i === slides.length - 1} aria-label="Next slide">
          <Arrow dir="right" />
        </button>
        <Link href="/" className="deck-exit">manmade.works</Link>
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
        <p className="deck-title-meta">NEAR · NFTs That Do Something</p>
      </div>
      <div className="deck-title-whole">
        <Hung moulding="gilt-pattern" plaque={<Plaque title={shortTitle(c.title)} line={`${c.artist}, ${c.date}`} level="Example · up close, left" />}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.src} alt={`${shortTitle(c.title)} by ${c.artist}`} width={c.width} height={c.height} />
        </Hung>
      </div>
    </div>
  );
}

/* ---------- 2. Why ---------- */
function Why() {
  return (
    <div className="deck-body">
      <h2 className="deck-h">AI is a good tool. <em>Slop</em> is not art.</h2>
      <div className="deck-why">
        <div>
          <p className="deck-col-h">A good tool</p>
          <p>References, clean-up, ideas. In an artist&rsquo;s hands it helps make the work.</p>
        </div>
        <div>
          <p className="deck-col-h">Sloppy generative AI</p>
          <p>Endless images with nobody behind them. It floods every feed and buries the people who still draw.</p>
        </div>
      </div>
      <blockquote className="deck-quote">
        A picture made by hand carries hours, choices and mistakes. That is its soul, and no prompt replaces it.
      </blockquote>
      <p className="deck-honest">
        Manmade can&rsquo;t stop AI art, and never claims a piece is &ldquo;proven not AI&rdquo;. It is the best attempt yet to show,
        honestly, what was made by hand.
      </p>
    </div>
  );
}

/* ---------- 3. The making, on record ---------- */
const STEPS: { h: string; p: string }[] = [
  { h: "Record", p: "Screen, camera or a paired phone, while the artist works." },
  { h: "Sign", p: "Every frame is signed on the artist’s device and chained to the last." },
  { h: "Anchor", p: "The chain is written to the piece on NEAR as the work grows." },
  { h: "Check", p: "Final file matched to the last frames; build-up, largest jump and time measured. Others can ask for a live code to appear in the work." },
  { h: "Label", p: "Declared, Recorded while made, or + live checks passed — in the same words every time." },
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
        <Check>Readers ask questions instead of calling art fake; only questions most raters find useful are shown.</Check>
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

/* ---------- 4. Not a basic NFT ---------- */
const TECH: { k: string; v: string }[] = [
  { k: "An account, not a pointer", v: "Each piece is its own NEAR account, created from one shared contract by code hash." },
  { k: "It holds the making", v: "Frame-chain anchors and a verifier-signed report live on the piece; withdrawn keys downgrade old records." },
  { k: "It holds money", v: "Commissions escrow inside the piece: payment stages, revisions, refusal deposits, two arbitrators." },
  { k: "It pays the artist again", v: "The resale royalty is enforced by the piece itself on every sale; licence income pools for the holder." },
  { k: "Still a standard token", v: "NEP-171 index on the collection, so wallets and explorers see every piece." },
  { k: "Private where it should be", v: "Frames encrypted at rest; collectors open files through short-lived links; one-signature sign-in (NEP-413)." },
];
function Tech() {
  return (
    <div className="deck-body">
      <h2 className="deck-h">Not a basic NFT. An NFT that <em>does</em> something.</h2>
      <dl className="deck-ledger">
        {TECH.map((t) => (
          <div key={t.k}>
            <dt>{t.k}</dt>
            <dd>{t.v}</dd>
          </div>
        ))}
      </dl>
      <p className="deck-close">Live on NEAR testnet · <Link href="/gallery">manmade.works</Link></p>
    </div>
  );
}

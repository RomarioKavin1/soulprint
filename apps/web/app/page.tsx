import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { loadGallery } from "@/lib/gallery";
import { CLASSICS, classic } from "@/lib/classics";
import { Hang, type HangItem } from "@/components/salon/Hang";

export const dynamic = "force-dynamic";

/** The opening wall: small examples stacked either side of the lettering and the newest piece. */
const OPENING_LEFT = ["met-437658", "met-45434"]; // Seurat study; Hokusai
const OPENING_RIGHT = ["met-436532", "met-438817"]; // Van Gogh self-portrait; Degas
const VERMEER = "met-437881"; // hangs at eye level when no artist has hung a piece yet

export default async function Home() {
  const config = loadConfig();
  const pieces = config ? await loadGallery(config.evidenceUrl, { limit: 48 }) : null;
  const [newest, ...rest] = pieces ?? [];

  const lettering: HangItem = {
    kind: "lettering",
    key: "welcome",
    node: (
      <div className="py-6">
        <h1 className="font-display text-[clamp(2.4rem,3.4vw,3.6rem)] leading-[1] tracking-[-0.02em] text-ink">
          Real art, hung<br className="hidden sm:inline" /> with its <em className="text-[color:var(--color-gilt-light)]">making</em>.
        </h1>
        <p className="mt-5 max-w-[34ch] text-[1.05rem] text-ink-2">
          Each work hangs here with the record of how it was made, frame by frame. Its label says only what that record shows. Follow the
          making, support the artist, or collect the work.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3 sm:flex-nowrap">
          <Link href="#hang" className="btn-seal no-underline">Walk the hang</Link>
          <Link href="/studio/new?mode=standalone" className="btn-ghost no-underline">Start a piece</Link>
        </div>
      </div>
    ),
  };
  const intro: HangItem = {
    kind: "lettering",
    key: "intro",
    node: (
      <div id="hang" className="scroll-mt-10 py-4">
        <h2 className="font-display text-[clamp(2rem,3.2vw,3rem)] leading-none tracking-[-0.01em]">The hang</h2>
        <p className="mt-4 max-w-[36ch] text-ink-2">
          Newest work first. Each label gives the level its record reached: <i>Declared</i>, <i>Recorded</i> while made, or recorded with live
          checks passed. Works marked <i>Example</i> are public-domain classics from The Met, hung to show the room; they were not recorded here.
        </p>
        {pieces === null && <p className="mt-3 text-sm text-ink-3" data-testid="gallery-unavailable">The artists’ work could not be loaded just now; reload in a moment.</p>}
        {pieces?.length === 0 && <p className="mt-3 text-sm text-ink-3" data-testid="gallery-empty">No artist has hung a piece yet; the examples hold the wall until they do.</p>}
      </div>
    ),
  };

  const closing: HangItem = {
    kind: "lettering",
    key: "closing",
    node: (
      <div className="py-4">
        <h2 className="font-display text-[clamp(1.8rem,2.6vw,2.6rem)] leading-[1.05] tracking-[-0.01em]">There is room on this wall for your work.</h2>
        <p className="mt-3 max-w-[32ch] text-ink-2">Record it as you make it, and hang it with its record.</p>
        <Link href="/studio/new?mode=standalone" className="btn-seal mt-5 no-underline">Start a piece</Link>
      </div>
    ),
  };
  const small = (slug: string): HangItem => ({ kind: "example", classic: classic(slug), size: "s" });
  const vermeer: HangItem = { kind: "example", classic: classic(VERMEER), size: "l", moulding: "gilt-pattern" };
  const used = new Set([...OPENING_LEFT, ...OPENING_RIGHT, VERMEER]);
  const examples = CLASSICS.filter((c) => !used.has(c.slug)).map((c) => ({ kind: "example" as const, classic: c }));
  const items: HangItem[] = [
    ...OPENING_LEFT.map(small),
    lettering,
    newest ? { kind: "piece", piece: newest, size: "l" } : vermeer,
    ...OPENING_RIGHT.map(small),
    intro,
    ...(newest ? [vermeer] : []),
    ...rest.map((piece) => ({ kind: "piece" as const, piece })),
    ...examples,
    closing,
  ];

  return (
    <div>
      <section className="bleed">
        <Hang items={items} label="The hang: published pieces, then examples" />
      </section>

      <section className="mx-auto mt-32 max-w-5xl">
        <div className="card sm:p-12">
          <h2 className="font-display text-[clamp(1.9rem,3vw,2.8rem)] leading-tight">How a work is hung</h2>
          <ol className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {[
              ["Make it on the record", "Record on any screen or with a camera. Each frame is signed on your device and its fingerprint anchored on NEAR as you work. Anyone you invite can ask for a live code to appear in the work while you make it."],
              ["Finish and seal", "Upload the finished image. The record is checked against it and the facts are signed onto the piece: how gradually it built up, the largest single jump, the time on record."],
              ["Hang it", "Publish the piece's page: a title, the frames you choose, your story. Its label says exactly what the record shows — never more, and never a verdict on you."],
              ["Share it", "Visitors can tip you directly. If you offer the work, a collector can take it home with its files and rights, and every resale pays you a royalty."],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[3rem_1fr]">
                <span className="font-display text-4xl leading-none text-seal">{["I", "II", "III", "IV"][i]}</span>
                <span>
                  <span className="block font-plaque text-[0.8rem] font-semibold uppercase tracking-[0.16em]">{t}</span>
                  <span className="mt-2 block text-ink-2">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-10 border-t border-rule pt-6 text-sm text-ink-3">
            Taking a commission instead? <Link className="text-ink underline" href="/studio/new">Set one up</Link> — the client’s payment waits in
            the piece until they accept.
          </p>
        </div>
      </section>
    </div>
  );
}

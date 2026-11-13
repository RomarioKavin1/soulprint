import Link from "next/link";
import type { CSSProperties } from "react";
import { loadConfig } from "@/lib/config";
import { loadGallery, pieceName, coverUrl, cardSentence } from "@/lib/gallery";
import { classic, shortTitle } from "@/lib/classics";
import { DECLARED_TEXT } from "@/lib/wording";
import { Hung, mouldingFor, Plaque } from "@/components/salon/Frame";
import { HeroBrushwork } from "@/components/landing/Heroes";
import { FitImg } from "@/components/salon/FitImg";

export const dynamic = "force-dynamic";

const THROUGH = ["met-45434", "met-438817", "met-436532", "met-435868", "met-436947"]; // seen through the last door

export default async function Landing() {
  const config = loadConfig();
  const pieces = config ? await loadGallery(config.evidenceUrl, { limit: 24 }) : null;
  // Room I hangs a real piece only when its record says more than "declared" and the work can be shown.
  const newest = pieces?.find((p) => p.level >= 2 && p.hasPreview) ?? null;

  return (
    <div>
      <HeroBrushwork />


      {/* ---- Room I: the making, on record ---- */}
      <section className="room grid items-center gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex justify-center">
          {newest ? (
            <Link href={`/p/${newest.pieceId}`} className="no-underline">
              <Hung
                moulding={mouldingFor(newest.pieceId)}
                mat={!newest.hasPreview}
                className="room-work"
                plaque={<Plaque title={pieceName(newest)} line={newest.artist} note={`${cardSentence(newest)}.`} />}
              >
                {coverUrl(newest) ? (
                  <FitImg src={coverUrl(newest)!} alt={pieceName(newest)} className="room-img" />
                ) : (
                  <span className="hang-blank room-img">The artist kept the frames private</span>
                )}
              </Hung>
            </Link>
          ) : (
            <ExampleWork slug="met-437658" />
          )}
        </div>
        <div>
          <p className="room-numeral">I</p>
          <h2 className="room-title">Made on the record</h2>
          <p className="room-text">
            While an artist works, the browser keeps a frame every minute or two, signs it on their own device and chains it to the one before.
            Fingerprints of that chain are anchored on NEAR as they go. When the work is finished, the record is checked against the final file,
            and the facts are signed onto the piece: how gradually it built up, the largest single jump, the time on record.
          </p>
          <p className="room-text">Every piece is its own account on NEAR, so its record, its rights and its sale history travel with it.</p>
          {newest && <Link href={`/p/${newest.pieceId}`} className="mt-6 inline-block text-ink underline">See how {pieceName(newest)} was made</Link>}
        </div>
      </section>

      {/* ---- Room II: what a label can say ---- */}
      <section className="room">
        <div className="mx-auto max-w-3xl text-center">
          <p className="room-numeral">II</p>
          <h2 className="room-title">A label says only what the record shows</h2>
          <p className="room-text mx-auto">
            Nobody can prove from a picture that no machine was involved, and Soulprint never claims to. Each label states one of three things,
            in the same words every time.
          </p>
        </div>
        <ol className="card mx-auto mt-12 max-w-4xl divide-y divide-rule !py-2">
          {[
            [DECLARED_TEXT, "The artist says it is theirs; the record is too short or too thin to say more."],
            ["Recorded while made", "For example: “Recorded while made: 94% built up on camera, 20–30h over 9 days.”"],
            ["Recorded, with live checks passed", "Someone else asked for a code, and it appeared in the work while it was being made."],
          ].map(([t, e], i) => (
            <li key={t} className="grid gap-x-8 gap-y-1 py-6 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
              <span className="font-display text-4xl leading-none text-seal">{["E0", "E2", "E3"][i]}</span>
              <span>
                <span className="block font-plaque text-[0.82rem] font-semibold uppercase tracking-[0.14em]">{t}</span>
                <span className="mt-1 block text-ink-2">{e}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-center text-sm text-ink-3">
          <Link href="/limits" className="text-ink-2 underline">What a record does and does not show</Link>
        </p>
      </section>

      {/* ---- Room III: questions, not verdicts ---- */}
      <section className="room grid items-start gap-x-16 gap-y-10 lg:grid-cols-2">
        <div>
          <p className="room-numeral">III</p>
          <h2 className="room-title">Questions, not verdicts</h2>
          <p className="room-text">
            When something in a record does not add up, a reader can ask about it and ask for more of the making. The artist answers. A question
            appears beside the work only when most readers who rated it found it useful, and it never changes what the record shows.
          </p>
          <Link href="/notes" className="mt-6 inline-block text-ink underline">How reader questions work</Link>
        </div>
        <figure className="card max-w-xl" aria-label="An illustration of a reader question">
          <p className="label">A reader asked</p>
          <p className="mt-1 font-display text-2xl">Does the making match the finished piece?</p>
          <p className="mt-3 text-ink-2">Between the second and third public frames the whole background appears at once, with no sketch underneath.</p>
          <p className="mt-3 text-sm text-moss">Asked for more frames of the making. The artist made 4 more frames public.</p>
          <div className="mt-4 border-t border-rule pt-3">
            <p className="label">The artist answered</p>
            <p className="mt-1 text-ink-2">I block in the background on paper first; the early frames are public now.</p>
          </div>
          <figcaption className="mt-4 text-xs italic text-ink-3">An illustration of how a question reads, not a real exchange.</figcaption>
        </figure>
      </section>

      {/* ---- Room IV: collect, and the artist is paid again ---- */}
      <section className="room mx-auto max-w-4xl text-center">
        <p className="room-numeral">IV</p>
        <h2 className="room-title">Support it, collect it, and the artist is paid again</h2>
        <p className="room-text mx-auto">
          Visitors can send an artist a tip from any work, whether or not it is for sale. If the artist offers a work, a collector can take it
          home with its files and the rights on its label, and every time it is resold the artist receives a royalty.
        </p>
        <p className="mt-6 text-sm text-ink-3">
          Taking a commission? <Link className="text-ink-2 underline" href="/studio/new">Set one up</Link> — the client’s payment waits in the
          piece until they accept.
        </p>
      </section>

      {/* ---- The last doorway: into the gallery ---- */}
      <section className="last-door bleed" aria-labelledby="last-door-title">
        <Link href="/gallery" className="door last-door-casing block no-underline" data-moulding="gilt-pattern" aria-label="Enter the gallery">
          <div className="last-door-view">
            <ul className="last-door-hang" aria-hidden>
              {THROUGH.map((s) => {
                const c = classic(s);
                return (
                  <li key={s}>
                    <Hung moulding={mouldingFor(c.slug)} mat={c.kind === "print"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.src} alt="" width={c.width} height={c.height} className="last-door-img" loading="lazy" />
                    </Hung>
                  </li>
                );
              })}
            </ul>
          </div>
        </Link>
        <p className="mt-3 text-center text-[0.82rem] italic text-ink-3">Seen through the door: {THROUGH.map((s) => shortTitle(classic(s).title)).join(", ")} — examples from The Met.</p>
        <div className="mt-12 text-center">
          <h2 id="last-door-title" className="font-display text-[clamp(2rem,3.6vw,3.4rem)] leading-tight">The gallery is through here.</h2>
          <p className="mx-auto mt-3 max-w-[48ch] text-ink-2">Sort by price, by what the record shows, or by artist; open any work to follow its making.</p>
          <Link href="/gallery" className="btn-seal mt-7 no-underline">Enter the gallery</Link>
        </div>
      </section>
    </div>
  );
}

function ExampleWork({ slug }: { slug: string }) {
  const c = classic(slug);
  const title = shortTitle(c.title);
  return (
    <a href={c.source} target="_blank" rel="noopener noreferrer" className="block no-underline" title={`${title} — open at The Met`}>
      <Hung moulding={mouldingFor(c.slug)} mat={c.kind === "print"} plaque={<Plaque title={title} line={`${c.artist}, ${c.date}`} level="Example" />}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.src} alt={`${title} by ${c.artist} — an example from The Met`} width={c.width} height={c.height} className="room-img" loading="lazy" style={{ "--ar": c.width / c.height } as CSSProperties} />
      </Hung>
    </a>
  );
}

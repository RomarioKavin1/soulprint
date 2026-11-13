import Link from "next/link";
import { classic, shortTitle } from "@/lib/classics";
import { Hung, Plaque } from "@/components/salon/Frame";

function Actions() {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Link href="/gallery" className="btn-seal no-underline" data-testid="enter-gallery">Enter the gallery</Link>
      <Link href="/studio/new?mode=standalone" className="btn-ghost no-underline">Start a piece</Link>
    </div>
  );
}

/** The landing hero, the brushwork: Van Gogh's sky, close enough to see every stroke, with the whole painting framed small. */
export function HeroBrushwork() {
  const c = classic("met-436535");
  return (
    <section className="hero-brush bleed" aria-labelledby="landing-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="hero-brush-paint" src="/salon/hero/wheat-field-brushwork.webp" alt="" />
      <div className="hero-brush-copy">
        <h1 id="landing-title" className="font-display text-balance text-[clamp(3rem,6.2vw,6rem)] leading-[0.94] tracking-[-0.025em]">
          Real art, hung with its <em className="text-seal">making</em>.
        </h1>
        <p className="mt-6 max-w-[38ch] text-lg text-ink-2">
          Up close, every stroke shows how a picture was made. On Soulprint, artists record that making as they work, and every piece hangs
          with its record.
        </p>
        <Actions />
      </div>
      <figure className="hero-brush-whole">
        <a href={c.source} target="_blank" rel="noopener noreferrer" className="block no-underline" title={`${shortTitle(c.title)} — open at The Met`}>
          <Hung moulding="gilt-pattern" plaque={<Plaque title={shortTitle(c.title)} line={`${c.artist}, ${c.date}`} level="Example · the sky above, up close" />}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.src} alt={`${shortTitle(c.title)} by ${c.artist}, the whole painting — an example from The Met`} width={c.width} height={c.height} className="hero-brush-whole-img" />
          </Hung>
        </a>
      </figure>
    </section>
  );
}

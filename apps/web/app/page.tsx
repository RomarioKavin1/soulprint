import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { loadGallery } from "@/lib/gallery";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = loadConfig();
  const pieces = config ? await loadGallery(config.evidenceUrl, { limit: 36 }) : null;
  return (
    <div className="pt-10 sm:pt-16">
      <p className="label">Real art, with the making on record</p>
      <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight sm:text-6xl">
        Show how your work was made. Every piece carries its own record.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-ink-2">
        Record your process as you draw or paint, frame by frame, signed on your device and anchored as you go. Publish the
        piece with its making and your story. People who love it can follow how it came to be, support you, or collect it —
        and if it is ever resold, you are paid again.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/studio/new?mode=standalone" className="btn-primary">
          Start a piece
        </Link>
        <Link href="/limits" className="btn-ghost">
          What a record does and does not show
        </Link>
      </div>

      <section className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-3xl tracking-tight">Gallery</h2>
          <p className="text-sm text-ink-3">Newest first. Each card says only what its record shows.</p>
        </div>
        <div className="mt-6">
          {pieces === null ? (
            <p className="card text-ink-2" data-testid="gallery-unavailable">The gallery could not be loaded just now. Reload in a moment.</p>
          ) : pieces.length === 0 ? (
            <p className="card text-ink-2" data-testid="gallery-empty">Nothing published yet. Finish a piece in your studio and publish its page to show it here.</p>
          ) : (
            <GalleryGrid pieces={pieces} />
          )}
        </div>
      </section>

      <ol className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ["Make", "Record on any screen or with a phone camera. Anyone you invite can ask for a live code to appear in the work while you make it."],
          ["Show", "Finish the piece and publish its page: the frames you choose, your story, and the facts the record supports — never more."],
          ["Share", "Supporters can send you a tip. Collectors can buy what you put up for sale; the files and rights go with it, and resales pay you a royalty."],
        ].map(([t, d], i) => (
          <li key={t} className="card">
            <span className="font-display text-3xl text-seal">{i + 1}</span>
            <p className="mt-2 font-medium">{t}</p>
            <p className="mt-1 text-sm text-ink-2">{d}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-ink-3">
        Taking a commission instead? <Link className="underline" href="/studio/new">Set one up</Link> — the client&apos;s payment waits in the piece until they accept.
      </p>
    </div>
  );
}

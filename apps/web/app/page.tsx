import Link from "next/link";

export default function Home() {
  return (
    <div className="pt-10 sm:pt-16">
      <p className="label">Commissioned art, with the making on record</p>
      <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight sm:text-6xl">
        Every commission gets its own account. The payment, the proof and the rights live inside it.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-ink-2">
        The client&apos;s payment waits in the piece until they accept. The artist records how the work was made, frame by
        frame, signed on their device and anchored as they go. On acceptance the piece and the rights pass to the client;
        if it is ever resold, the artist is paid again.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/studio" className="btn-primary">
          Open your studio
        </Link>
        <Link href="/limits" className="btn-ghost">
          What a record does and does not show
        </Link>
      </div>
      <ol className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ["Agree", "Price, milestones, deadline, revisions and the rights the client is buying — fixed before any money moves."],
          ["Make", "Capture your process on any screen or with a phone camera. The client can ask for a live code to appear in the work."],
          ["Hand over", "The client accepts, the payment releases, and the piece — with its process record — becomes theirs."],
        ].map(([t, d], i) => (
          <li key={t} className="card">
            <span className="font-display text-3xl text-seal">{i + 1}</span>
            <p className="mt-2 font-medium">{t}</p>
            <p className="mt-1 text-sm text-ink-2">{d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

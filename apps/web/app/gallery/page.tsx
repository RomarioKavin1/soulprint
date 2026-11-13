import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { loadGallery } from "@/lib/gallery";
import { CLASSICS } from "@/lib/classics";
import { applyQuery, artistsOf, AVAILABILITY, buildItems, LEVELS, parseQuery, queryString, type MarketRow } from "@/lib/showcase";
import { ShowcaseControls } from "@/components/salon/ShowcaseControls";
import { ShowcaseGrid } from "@/components/salon/ShowcaseGrid";

export const dynamic = "force-dynamic";

async function loadMarket(): Promise<MarketRow[] | null> {
  try {
    const r = await fetch(`${process.env.INDEXER_URL ?? "http://127.0.0.1:8788"}/market`, { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()) as { pieces: MarketRow[] }).pieces;
  } catch {
    return null;
  }
}

/** The showcase: every published work and the labelled examples, sortable and filterable. */
export default async function GalleryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseQuery(await searchParams);
  const config = loadConfig();
  const [pieces, market] = await Promise.all([config ? loadGallery(config.evidenceUrl, { limit: 60 }) : null, loadMarket()]);
  const all = buildItems(pieces ?? [], market ?? [], CLASSICS);
  const shown = applyQuery(all, query);
  const realCount = all.filter((i) => i.kind === "piece").length;
  const filtered = queryString({ ...query, sort: "newest" }) !== "";
  // Each active filter, with a link that clears only that one.
  const active: { label: string; href: string }[] = [
    ...(query.q ? [{ label: `search “${query.q}”`, href: `/gallery${queryString({ ...query, q: "" })}` }] : []),
    ...(query.level !== "any" ? [{ label: `record: ${LEVELS[query.level]}`, href: `/gallery${queryString({ ...query, level: "any" })}` }] : []),
    ...(query.availability !== "any" ? [{ label: AVAILABILITY[query.availability].toLowerCase(), href: `/gallery${queryString({ ...query, availability: "any" })}` }] : []),
    ...(query.artist ? [{ label: `artist ${query.artist}`, href: `/gallery${queryString({ ...query, artist: "" })}` }] : []),
    ...(!query.examples ? [{ label: "examples hidden", href: `/gallery${queryString({ ...query, examples: true })}` }] : []),
  ];

  return (
    <div className="page-top">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <h1 className="title-display">The gallery</h1>
        <p className="tabular text-ink-2" data-testid="result-count">
          {shown.length} {shown.length === 1 ? "work" : "works"}
          {filtered ? ` of ${all.length}` : ""} · {realCount} by artists on Manmade
        </p>
      </header>
      <p className="mt-4 max-w-[68ch] text-ink-2">
        Every work hangs with a label saying what its record shows. Works marked <i>Example</i> are public-domain classics from The Met, hung to
        show the room; they were not recorded here.
      </p>
      {pieces === null && <p className="mt-3 text-sm text-ink-3" data-testid="gallery-unavailable">The artists’ work could not be loaded just now; the examples are still here. Reload in a moment.</p>}
      {market === null && pieces !== null && <p className="mt-3 text-sm text-ink-3">Prices could not be loaded just now; each work’s own page always shows its current price.</p>}

      <ShowcaseControls query={query} artists={artistsOf(all)} />

      {shown.length === 0 ? (
        <div className="card mx-auto mt-14 max-w-xl text-center" data-testid="no-results">
          <p className="font-display text-2xl">Nothing on the wall matches</p>
          <p className="mt-2 text-ink-2">No work matches {active.length === 1 ? "this filter" : "all of these filters"}. Remove one:</p>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {active.map((a) => (
              <li key={a.label}><Link href={a.href} className="chip chip-quiet no-underline">Clear {a.label}</Link></li>
            ))}
          </ul>
          <Link href="/gallery" className="btn-ghost mt-5 no-underline">Show every work</Link>
        </div>
      ) : (
        <ShowcaseGrid items={shown} decimals={config?.currencyDecimals ?? 6} />
      )}
    </div>
  );
}

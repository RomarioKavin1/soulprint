"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AVAILABILITY, LEVELS, queryString, SORTS, type Query } from "@/lib/showcase";

/**
 * The finding aid: one printed bar of controls. Every change rewrites the URL (so any view is a
 * link) and the server re-hangs the wall. Works as a plain GET form without JavaScript.
 */
export function ShowcaseControls({ query, artists }: { query: Query; artists: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(query.q);
  // The controls show a change at once; the URL (and the server's wall) follow.
  const [view, setView] = useState(query);
  useEffect(() => { setView(query); setQ(query.q); }, [query]);
  const [pending, start] = useTransition();
  const go = (next: Partial<Query>) => {
    const merged = { ...view, q, ...next };
    setView(merged);
    start(() => router.replace(`${path}${queryString(merged)}`, { scroll: false }));
  };
  const anyFilter = queryString({ ...view, sort: "newest" }) !== "";

  return (
    <form
      action={path}
      method="get"
      role="search"
      aria-label="Find works"
      className="finding-aid mt-10"
      data-pending={pending || undefined}
      onSubmit={(e) => { e.preventDefault(); go({ q }); }}
    >
      <label className="fa-search">
        <span className="label">Search</span>
        <input className="field" name="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or artist" aria-label="Search titles and artists" />
      </label>
      <label>
        <span className="label">Record</span>
        <select className="field" name="level" value={view.level} onChange={(e) => go({ level: e.target.value as Query["level"] })} aria-label="Record level">
          {Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>
        <span className="label">Availability</span>
        <select className="field" name="availability" value={view.availability} onChange={(e) => go({ availability: e.target.value as Query["availability"] })} aria-label="Availability">
          {Object.entries(AVAILABILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>
        <span className="label">Artist</span>
        <select className="field" name="artist" value={view.artist} onChange={(e) => go({ artist: e.target.value })} aria-label="Artist">
          <option value="">Every artist</option>
          {artists.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label>
        <span className="label">Sort</span>
        <select className="field" name="sort" value={view.sort} onChange={(e) => go({ sort: e.target.value as Query["sort"] })} aria-label="Sort">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="fa-toggle">
        <input type="checkbox" name="examples" value="show" aria-label="Show examples" checked={view.examples} onChange={(e) => go({ examples: e.target.checked })} />
        <span>Show examples</span>
      </label>
      <div className="fa-actions">
        <button type="submit" className="btn-ghost">Search</button>
        {/* the slot is always there, so the bar never shifts when a filter is set */}
        {(
          <button type="button" className="fa-reset" disabled={!anyFilter} aria-hidden={!anyFilter || undefined} tabIndex={anyFilter ? undefined : -1} style={anyFilter ? undefined : { visibility: "hidden" }} onClick={() => { setQ(""); const cleared = { ...view, q: "", level: "any" as const, availability: "any" as const, artist: "", examples: true }; setView(cleared); start(() => router.replace(`${path}${queryString({ sort: view.sort })}`, { scroll: false })); }}>
            Clear filters
          </button>
        )}
      </div>
    </form>
  );
}

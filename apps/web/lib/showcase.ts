/**
 * The showcase (13 Nov): every published piece and the labelled examples as one sortable,
 * filterable collection. Pure functions over the gallery feed (evidence service), the market
 * (indexer) and the classics; the page reads the query from the URL so every view is a link.
 */
import type { GalleryPiece } from "./gallery.ts";
import { cardSentence, coverUrl, pieceName } from "./gallery.ts";
import { shortTitle, type Classic } from "./classics.ts";
import { galleryBadge } from "./context-notes.ts";
import type { Currency } from "./terms.ts";

export interface MarketRow {
  pieceId: string;
  artist: string;
  currency: Currency;
  owner: string | null;
  listing: { price: string; reservedFor: string | null } | null;
  sales: number;
  lastSale: { price: string; atMs: number } | null;
}

export interface ShowcaseItem {
  kind: "piece" | "example";
  id: string;
  href: string;
  title: string;
  artist: string;
  /** null for examples: they have no record. */
  level: 0 | 2 | 3 | null;
  sentence: string | null;
  publishedAt: number;
  image: string | null;
  width?: number;
  height?: number;
  currency: Currency | null;
  price: bigint | null;
  reserved: boolean;
  collected: boolean;
  questions: number;
  /** Neutral note when readers asked a question that is shown (says when the artist answered). */
  notesBadge: string | null;
  date?: string;
}

export const SORTS = {
  newest: "Newest first",
  oldest: "Oldest first",
  "price-asc": "Price, low to high",
  "price-desc": "Price, high to low",
  record: "Strongest record first",
  title: "Title, A–Z",
} as const;
export type Sort = keyof typeof SORTS;

export const LEVELS = { any: "Any record", declared: "Declared", recorded: "Recorded while made", checked: "Live checks passed" } as const;
export const AVAILABILITY = { any: "All works", "for-sale": "For sale", collected: "Collected" } as const;

export interface Query {
  sort: Sort;
  level: keyof typeof LEVELS;
  availability: keyof typeof AVAILABILITY;
  q: string;
  artist: string;
  examples: boolean;
}

/** URL search params → a query, tolerating anything a visitor types into the address bar. */
export function parseQuery(sp: Record<string, string | string[] | undefined>): Query {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const pick = <T extends string>(v: string, allowed: readonly T[], d: T): T => ((allowed as readonly string[]).includes(v) ? (v as T) : d);
  return {
    sort: pick(one("sort"), Object.keys(SORTS) as Sort[], "newest"),
    level: pick(one("level"), Object.keys(LEVELS) as (keyof typeof LEVELS)[], "any"),
    availability: pick(one("availability"), Object.keys(AVAILABILITY) as (keyof typeof AVAILABILITY)[], "any"),
    q: one("q").slice(0, 80),
    artist: one("artist").slice(0, 100),
    examples: one("examples") !== "hide",
  };
}

/** The query back to URL params, leaving defaults out so links stay short. */
export function queryString(q: Partial<Query>): string {
  const p = new URLSearchParams();
  if (q.sort && q.sort !== "newest") p.set("sort", q.sort);
  if (q.level && q.level !== "any") p.set("level", q.level);
  if (q.availability && q.availability !== "any") p.set("availability", q.availability);
  if (q.q) p.set("q", q.q);
  if (q.artist) p.set("artist", q.artist);
  if (q.examples === false) p.set("examples", "hide");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function buildItems(gallery: GalleryPiece[], market: MarketRow[], classics: Classic[]): ShowcaseItem[] {
  const byId = new Map(market.map((m) => [m.pieceId, m]));
  const pieces: ShowcaseItem[] = gallery.map((p) => {
    const m = byId.get(p.pieceId);
    return {
      kind: "piece",
      id: p.pieceId,
      href: `/p/${p.pieceId}`,
      title: pieceName(p),
      artist: p.artist,
      level: p.level,
      sentence: cardSentence(p),
      publishedAt: p.publishedAt,
      image: coverUrl(p),
      currency: m?.currency ?? null,
      price: m?.listing ? BigInt(m.listing.price) : null,
      reserved: !!m?.listing?.reservedFor,
      collected: !!m && ((m.owner !== null && m.owner !== p.artist) || m.sales > 0),
      questions: p.notes?.shown ?? 0,
      notesBadge: galleryBadge(p.notes),
    };
  });
  const examples: ShowcaseItem[] = classics.map((c, i) => ({
    kind: "example",
    id: c.slug,
    href: c.source,
    title: shortTitle(c.title),
    artist: c.artist,
    level: null,
    sentence: null,
    publishedAt: -1 - i, // after every real piece, in their own order
    image: c.kind === "sculpture" ? `/salon/sculpture/${c.slug}.webp` : c.src,
    width: c.width,
    height: c.height,
    currency: null,
    price: null,
    reserved: false,
    collected: false,
    questions: 0,
    notesBadge: null,
    date: c.date,
  }));
  return [...pieces, ...examples];
}

const RECORD_RANK = (l: ShowcaseItem["level"]) => (l === null ? -1 : l);

export function applyQuery(items: ShowcaseItem[], q: Query): ShowcaseItem[] {
  const needle = q.q.trim().toLowerCase();
  const out = items.filter((it) => {
    if (it.kind === "example" && !q.examples) return false;
    if (q.artist && it.artist !== q.artist) return false;
    if (needle && !`${it.title} ${it.artist}`.toLowerCase().includes(needle)) return false;
    if (q.level !== "any") {
      const want = { declared: 0, recorded: 2, checked: 3 }[q.level];
      if (it.level !== want) return false;
    }
    if (q.availability === "for-sale" && it.price === null) return false;
    if (q.availability === "collected" && !it.collected) return false;
    return true;
  });
  const byPrice = (dir: 1 | -1) => (a: ShowcaseItem, b: ShowcaseItem) => {
    // Works without a price always sort after priced ones, whichever direction.
    if (a.price === null || b.price === null) return a.price === null ? (b.price === null ? 0 : 1) : -1;
    return a.price === b.price ? 0 : (a.price < b.price ? -1 : 1) * dir;
  };
  const cmp: Record<Sort, (a: ShowcaseItem, b: ShowcaseItem) => number> = {
    newest: (a, b) => b.publishedAt - a.publishedAt,
    oldest: (a, b) => (a.kind === b.kind ? a.publishedAt - b.publishedAt : a.kind === "piece" ? -1 : 1),
    "price-asc": byPrice(1),
    "price-desc": byPrice(-1),
    record: (a, b) => RECORD_RANK(b.level) - RECORD_RANK(a.level) || b.publishedAt - a.publishedAt,
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return [...out].sort(cmp[q.sort]);
}

/** Artists with at least one piece, for the artist filter. */
export function artistsOf(items: ShowcaseItem[]) {
  return [...new Set(items.filter((i) => i.kind === "piece").map((i) => i.artist))].sort();
}

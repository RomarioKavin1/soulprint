/**
 * Public-domain classics (The Met Open Access, CC0) hung in the salon as examples until real work
 * fills it. They were not recorded on Soulprint: they never carry a record level, a price or a
 * collect button, and every one links to its museum page. Provenance: public/classics/classics.json.
 */
import data from "../public/classics/classics.json";

export interface Classic {
  slug: string;
  src: string;
  width: number;
  height: number;
  title: string;
  artist: string;
  date: string;
  medium: string;
  kind: "painting" | "sculpture" | "print";
  museum: string;
  source: string;
  licence: string;
  credit: string;
}

export const CLASSICS = data as Classic[];

/** Short title: the Met's titles carry long parentheticals. */
export function shortTitle(t: string) {
  return t.replace(/\s*\(.*$/, "").replace(/^Wall painting:\s*/, "").replace(/^Marble statue of a /, "").replace(/^\w/, (c) => c.toUpperCase());
}

export function classic(slug: string) {
  const c = CLASSICS.find((x) => x.slug === slug);
  if (!c) throw new Error(`unknown classic ${slug}`);
  return c;
}

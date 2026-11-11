/** RFC 8785 JSON canonicalisation. The package is CJS (`module.exports = fn`) with ESM-style typings. */
import mod from "canonicalize";

const fn = ((mod as any).default ?? mod) as (input: unknown) => string | undefined;

export function jcs(value: unknown): string {
  const s = fn(value);
  if (s === undefined) throw new Error("value is not JSON-serialisable");
  return s;
}

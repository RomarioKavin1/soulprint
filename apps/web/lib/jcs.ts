import mod from "canonicalize";
const fn = ((mod as any).default ?? mod) as (v: unknown) => string | undefined;
/** RFC 8785 (A36): the report hash is sha256 of this text. */
export function jcs(v: unknown): string {
  const s = fn(v);
  if (s === undefined) throw new Error("not JSON");
  return s;
}

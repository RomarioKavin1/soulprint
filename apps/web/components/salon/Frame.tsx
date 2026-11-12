import type { CSSProperties, ReactNode } from "react";

/** Photographed period frames (public/salon/frames, The Met Open Access, CC0). */
export type Moulding = "gilt" | "gilt-pattern" | "walnut" | "inlaid";
const MOULDINGS: Moulding[] = ["gilt", "gilt-pattern", "walnut", "gilt", "inlaid", "gilt-pattern", "walnut"];

/** A stable moulding per work, so a piece keeps its frame wherever it hangs. */
export function mouldingFor(key: string): Moulding {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MOULDINGS[h % MOULDINGS.length]!;
}

/**
 * A framed picture. `children` is the picture (an <img> sized by the caller); `plaque` hangs
 * under it. Purely presentational, safe in server components.
 */
export function Hung({ moulding, mat, plaque, children, style, className = "", testId }: {
  moulding: Moulding; mat?: boolean; plaque?: ReactNode; children: ReactNode; style?: CSSProperties; className?: string; testId?: string;
}) {
  return (
    <figure className={`hung ${className}`} style={style} data-testid={testId}>
      <span className="frame" data-moulding={moulding}>
        <span className="frame-sight" data-mat={mat ? "linen" : undefined}>{children}</span>
      </span>
      {plaque}
    </figure>
  );
}

export function Plaque({ title, line, level, note, story }: { title: ReactNode; line?: ReactNode; level?: ReactNode; note?: ReactNode; story?: ReactNode }) {
  return (
    <figcaption className="plaque">
      <span className="plaque-title">{title}</span>
      {line && <span className="plaque-line">{line}</span>}
      {level && <span className="plaque-level">{level}</span>}
      {note && <span className="plaque-note">{note}</span>}
      {story && <span className="plaque-note plaque-story">{story}</span>}
    </figcaption>
  );
}

/**
 * Sculpture stands free on its own photographed base: the work cut from its museum photograph with a matte
 * derived from that photograph (public/salon/sculpture, scripts/salon-assets.py).
 */
export function Sculpture({ src, alt, plaque, style, className = "" }: { src: string; alt: string; plaque?: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <figure className={`hung sculpture ${className}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" />
      {plaque}
    </figure>
  );
}

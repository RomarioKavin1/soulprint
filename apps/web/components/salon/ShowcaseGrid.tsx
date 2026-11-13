import Link from "next/link";
import type { CSSProperties } from "react";
import { money } from "@/lib/money";
import { LEVEL_TEXT } from "@/lib/wording";
import type { ShowcaseItem } from "@/lib/showcase";
import { mouldingFor } from "./Frame";
import { FitImg } from "./FitImg";

/** An even catalogue wall: every work framed in an equal cell, with a printed label. */
export function ShowcaseGrid({ items, decimals }: { items: ShowcaseItem[]; decimals: number }) {
  return (
    <ul className="showcase" data-testid="gallery">
      {items.map((it, i) => (
        <li key={it.id} className="showcase-cell" style={{ "--i": i } as CSSProperties} data-testid={it.kind === "piece" ? "gallery-card" : "example-card"}>
          <Cell it={it} decimals={decimals} />
        </li>
      ))}
    </ul>
  );
}

function Cell({ it, decimals }: { it: ShowcaseItem; decimals: number }) {
  const example = it.kind === "example";
  const sculpture = example && it.image?.startsWith("/salon/sculpture/");
  const picture = it.image && !it.width ? (
    <FitImg src={it.image} alt={it.title} loading="lazy" />
  ) : it.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={it.image} alt={example ? `${it.title} by ${it.artist} — an example from The Met, not recorded on Manmade` : it.title} width={it.width} height={it.height} loading="lazy"
      style={it.width && it.height && !sculpture ? ({ "--ar": it.width / it.height } as CSSProperties) : undefined} />
  ) : (
    <span className="showcase-blank">The artist kept the frames private</span>
  );
  const art = sculpture ? (
    <span className="showcase-sculpture">{picture}</span>
  ) : (
    <span className="frame" data-moulding={mouldingFor(it.id)}>
      <span className="frame-sight" data-mat={!it.image ? "linen" : undefined}>{picture}</span>
    </span>
  );
  const linkProps = example ? { href: it.href, target: "_blank", rel: "noopener noreferrer" } : { href: it.href };
  return (
    <>
      {example ? (
        <a {...linkProps} className="showcase-art" aria-label={`${it.title} — open at The Met`}>{art}</a>
      ) : (
        <Link href={it.href} className="showcase-art" aria-label={`${it.title} — see how it was made`}>{art}</Link>
      )}
      <div className="showcase-label">
        <p className="plaque-title">
          {example ? <a {...linkProps}>{it.title}</a> : <Link href={it.href}>{it.title}</Link>}
        </p>
        <p className="plaque-line">
          {example ? `${it.artist}${it.date ? `, ${it.date}` : ""}` : <Link href={`/a/${it.artist}`} data-testid="card-artist">{it.artist}</Link>}
        </p>
        <div className="showcase-meta">
          <span className="plaque-level">{example ? "Example" : LEVEL_TEXT[it.level as 0 | 2 | 3]?.badge}</span>
          {!example && (
            <span className="showcase-price tabular" data-testid="card-price">
              {it.price !== null && it.currency ? (it.reserved ? `Reserved · ${money(it.price, it.currency, decimals)}` : money(it.price, it.currency, decimals)) : it.collected ? "Collected" : "Not for sale"}
            </span>
          )}
        </div>
        {it.sentence && it.level !== 0 && <p className="plaque-note">{it.sentence}.</p>}
        {it.notesBadge && <Link href={`${it.href}#notes`} className="plaque-note" data-testid="card-notes">{it.notesBadge}</Link>}
      </div>
    </>
  );
}

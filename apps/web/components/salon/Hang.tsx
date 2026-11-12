import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cardSentence, coverUrl, levelBadge, pieceName, type GalleryPiece } from "@/lib/gallery";
import { galleryBadge } from "@/lib/context-notes";
import { shortTitle, type Classic } from "@/lib/classics";
import { Hung, mouldingFor, Plaque, Sculpture, type Moulding } from "./Frame";

type Size = "x" | "l" | "m" | "s";
export type HangItem =
  | { kind: "piece"; piece: GalleryPiece; size?: Size }
  | { kind: "example"; classic: Classic; size?: Size; moulding?: Moulding }
  | { kind: "lettering"; key: string; node: ReactNode };

/** A salon rhythm: large anchors, medium works, small ones stacked in pairs between them. */
const RHYTHM: Exclude<Size, "x">[] = ["l", "s", "s", "m", "s", "s", "l", "m", "s", "s", "m", "l", "s", "s"];

/**
 * The salon hang: works hung close together on one centre line, sizes varied, small works
 * stacked in pairs. Lettering (a headline painted on the wall) can hang in line with them.
 */
export function Hang({ items, showArtist = true, label, id }: { items: HangItem[]; showArtist?: boolean; label: string; id?: string }) {
  let r = 0;
  const sized = items.map((item) => {
    if (item.kind === "lettering") return { item, size: "lettering" as const };
    // Sculpture and very tall works never hang small: a narrow sliver under a tall label reads as a mistake.
    const tall = item.kind === "example" && (item.classic.kind === "sculpture" || item.classic.height / item.classic.width > 1.45);
    const next = RHYTHM[r++ % RHYTHM.length]!;
    const size = item.size ?? (tall && next === "s" ? "m" : next);
    return { item, size };
  });
  const columns: { size: Size | "lettering"; entries: { item: HangItem; i: number }[] }[] = [];
  sized.forEach(({ item, size }, i) => {
    const last = columns.at(-1);
    if (size === "s" && last && last.size === "s" && last.entries.length === 1) last.entries.push({ item, i });
    else columns.push({ size, entries: [{ item, i }] });
  });
  return (
    <ul className="hang" aria-label={label} data-testid="gallery" id={id}>
      {columns.map((col, c) => (
        <li key={c} className={col.size === "lettering" ? "hang-lettering" : `hang-col h-${col.size}`} data-key={col.entries[0]?.item.kind === "lettering" ? col.entries[0].item.key : undefined}>
          {col.entries.map(({ item, i }) =>
            item.kind === "lettering" ? (
              <div key={item.key}>{item.node}</div>
            ) : item.kind === "piece" ? (
              <PieceOnWall key={item.piece.pieceId} p={item.piece} i={i} showArtist={showArtist} />
            ) : (
              <ExampleOnWall key={item.classic.slug} c={item.classic} i={i} moulding={item.moulding} />
            ),
          )}
        </li>
      ))}
    </ul>
  );
}

function PieceOnWall({ p, i, showArtist }: { p: GalleryPiece; i: number; showArtist: boolean }) {
  const img = coverUrl(p);
  const name = pieceName(p);
  const badge = galleryBadge(p.notes);
  return (
    <div className="hang-item" data-testid="gallery-card" style={{ "--i": i } as CSSProperties}>
      <Hung
        moulding={mouldingFor(p.pieceId)}
        mat={!p.hasPreview}
        plaque={
          <Plaque
            title={<Link href={`/p/${p.pieceId}`} className="no-underline hover:underline">{name}</Link>}
            line={showArtist ? <Link href={`/a/${p.artist}`} data-testid="card-artist" className="hover:underline">{p.artist}</Link> : undefined}
            level={p.level > 0 ? levelBadge(p.level) : undefined}
            note={`${cardSentence(p)}.`}
            story={p.story ? `“${p.story}”` : undefined}
          />
        }
      >
        <Link href={`/p/${p.pieceId}`} aria-label={`${name} — see how it was made`} className="block">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={p.hasPreview ? name : `${name}, a frame from its making`} className="hang-img" loading="lazy" />
          ) : (
            <span className="hang-blank">The artist kept the frames private</span>
          )}
        </Link>
      </Hung>
      {badge && (
        <Link href={`/p/${p.pieceId}#notes`} className="hang-note" data-testid="card-notes">
          {badge}
        </Link>
      )}
    </div>
  );
}

function ExampleOnWall({ c, i, moulding }: { c: Classic; i: number; moulding?: Moulding }) {
  const title = shortTitle(c.title);
  const plaque = <Plaque title={title} line={`${c.artist}${c.date ? `, ${c.date}` : ""}`} level="Example" />;
  const alt = `${title} by ${c.artist} — an example from The Met, not recorded on Soulprint`;
  return (
    <a href={c.source} target="_blank" rel="noopener noreferrer" className="hang-item block no-underline" style={{ "--i": i } as CSSProperties} data-testid="example-card" title={`${title} — open at ${c.museum}`}>
      {c.kind === "sculpture" ? (
        <Sculpture src={`/salon/sculpture/${c.slug}.webp`} alt={alt} plaque={plaque} />
      ) : (
        <Hung moulding={moulding ?? mouldingFor(c.slug)} mat={c.kind === "print"} plaque={plaque}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.src} alt={alt} width={c.width} height={c.height} className="hang-img" loading="lazy" />
        </Hung>
      )}
    </a>
  );
}

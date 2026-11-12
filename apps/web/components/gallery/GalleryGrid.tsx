import Link from "next/link";
import { cardSentence, coverUrl, levelBadge, pieceName, type GalleryPiece } from "@/lib/gallery";
import { galleryBadge } from "@/lib/context-notes";

/** Cards for published pieces: the last public frame, who made it, and what the record shows. */
export function GalleryGrid({ pieces, showArtist = true }: { pieces: GalleryPiece[]; showArtist?: boolean }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="gallery">
      {pieces.map((p) => {
        const img = coverUrl(p);
        const badge = galleryBadge(p.notes);
        return (
          <li key={p.pieceId} className="card flex flex-col p-0 overflow-hidden" data-testid="gallery-card">
            <Link href={`/p/${p.pieceId}`} className="block aspect-[4/3] bg-paper-2">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt={p.hasPreview ? pieceName(p) : `${pieceName(p)}, a frame from its making`} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-3">The artist kept the frames private</span>
              )}
            </Link>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/p/${p.pieceId}`} className="font-display text-lg hover:underline">
                  {pieceName(p)}
                </Link>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${p.level === 0 ? "border border-rule text-ink-2" : "bg-seal text-paper"}`}>{levelBadge(p.level)}</span>
              </div>
              {showArtist && (
                <Link href={`/a/${p.artist}`} className="text-sm text-ink-2 hover:underline" data-testid="card-artist">
                  by {p.artist}
                </Link>
              )}
              <p className="text-sm">{cardSentence(p)}.</p>
              {badge && (
                <Link href={`/p/${p.pieceId}#notes`} className="self-start rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-2" data-testid="card-notes">
                  {badge}
                </Link>
              )}
              {p.story && <p className="line-clamp-3 font-display text-sm italic text-ink-2">“{p.story}”</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

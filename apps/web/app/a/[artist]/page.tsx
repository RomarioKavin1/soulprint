import { loadConfig } from "@/lib/config";
import { loadGallery } from "@/lib/gallery";
import { Hang } from "@/components/salon/Hang";

export const dynamic = "force-dynamic";

/** An artist's room: their published work, newest first. */
export default async function ArtistPage({ params }: { params: Promise<{ artist: string }> }) {
  const { artist } = await params;
  const id = decodeURIComponent(artist);
  const config = loadConfig();
  if (!config) return <p className="pt-10">Not set up yet.</p>;
  const pieces = await loadGallery(config.evidenceUrl, { artist: id, limit: 60 });
  const recorded = pieces?.filter((p) => p.level > 0).length ?? 0;
  return (
    <div className="pt-14 sm:pt-20">
      <header className="mx-auto max-w-4xl text-center">
        <h1 className="break-all font-display text-[clamp(2.2rem,5vw,4.4rem)] leading-[1.02] tracking-[-0.015em]" data-testid="artist-name">{id}</h1>
        {pieces && pieces.length > 0 && (
          <p className="mt-5 text-ink-2">
            {pieces.length} published piece{pieces.length === 1 ? "" : "s"}
            {recorded > 0 ? `, ${recorded} recorded while made` : ""}.
          </p>
        )}
      </header>
      <div className="mt-6">
        {pieces === null ? (
          <p className="card mx-auto mt-10 max-w-xl text-ink-2">This room could not be opened just now. Reload in a moment.</p>
        ) : pieces.length === 0 ? (
          <p className="card mx-auto mt-10 max-w-xl text-ink-2">Nothing hung in this room yet.</p>
        ) : (
          <Hang items={pieces.map((piece) => ({ kind: "piece" as const, piece }))} showArtist={false} label={`Work by ${id}`} />
        )}
      </div>
    </div>
  );
}

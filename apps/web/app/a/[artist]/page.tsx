import { loadConfig } from "@/lib/config";
import { loadGallery } from "@/lib/gallery";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";

export const dynamic = "force-dynamic";

/** An artist's published work, newest first. */
export default async function ArtistPage({ params }: { params: Promise<{ artist: string }> }) {
  const { artist } = await params;
  const id = decodeURIComponent(artist);
  const config = loadConfig();
  if (!config) return <p className="pt-10">Not set up yet.</p>;
  const pieces = await loadGallery(config.evidenceUrl, { artist: id, limit: 60 });
  const recorded = pieces?.filter((p) => p.level > 0).length ?? 0;
  return (
    <div className="pt-10">
      <p className="label">Artist</p>
      <h1 className="mt-2 break-all font-display text-4xl tracking-tight" data-testid="artist-name">{id}</h1>
      {pieces && pieces.length > 0 && (
        <p className="mt-2 text-ink-2">
          {pieces.length} published piece{pieces.length === 1 ? "" : "s"}
          {recorded > 0 ? `, ${recorded} recorded while made` : ""}.
        </p>
      )}
      <div className="mt-8">
        {pieces === null ? (
          <p className="card text-ink-2">This page could not be loaded just now. Reload in a moment.</p>
        ) : pieces.length === 0 ? (
          <p className="card text-ink-2">No published pieces yet.</p>
        ) : (
          <GalleryGrid pieces={pieces} showArtist={false} />
        )}
      </div>
    </div>
  );
}

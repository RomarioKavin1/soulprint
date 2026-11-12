"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PieceInfo } from "@/lib/piece";
import { ErrorNote, Section, useAction, usePoll } from "@/components/ui";
import { useEvidence } from "@/lib/evidence";

interface Publication { hasReport: boolean; published: boolean; title: string | null; showFinal: boolean; story: string | null }

/**
 * The piece's public page: private until the artist publishes it (DESIGN §4). Shows whether it is
 * published, the title, whether the finished image is shown, and the saved story (review B8).
 */
export function PublishPanel({ piece }: { piece: PieceInfo }) {
  const evidence = useEvidence();
  const { data, reload } = usePoll(() => evidence<Publication>("GET", `/pieces/${piece.piece_id}/publication`), 15_000, [piece.piece_id, piece.report_hash]);
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [showFinal, setShowFinal] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (data && !loaded) {
      setTitle(data.title ?? "");
      setStory(data.story ?? "");
      setShowFinal(data.showFinal);
      setLoaded(true);
    }
  }, [data, loaded]);
  if (!piece.report_hash || !data) return null;
  const publish = (on: boolean) =>
    run("Saving", async () => {
      await evidence("POST", `/pieces/${piece.piece_id}/publish`, { published: on, title, showFinal });
      if (story.trim() && story.trim() !== (data.story ?? "")) await evidence("POST", `/pieces/${piece.piece_id}/story`, { text: story.trim() });
      await reload();
    });
  const dirty = title !== (data.title ?? "") || story.trim() !== (data.story ?? "") || showFinal !== data.showFinal;
  return (
    <Section
      title="The piece's page"
      aside={
        <span className={data.published ? "chip" : "chip chip-quiet"} data-testid="publish-state">
          {data.published ? "Published" : "Private"}
        </span>
      }
    >
      <p className="text-sm text-ink-2">Publishing shows the facts of your record, the frames you marked for the page and your story. Never the price.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label block">Title (optional)</span>
          <input className="field mt-1" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Title" placeholder="Harbour at dusk" />
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showFinal} onChange={(e) => setShowFinal(e.target.checked)} /> Show the finished image (a preview; the full file stays for the holder)
        </label>
      </div>
      <label className="mt-4 block">
        <span className="label">Your story (shown on the page)</span>
        <textarea className="field mt-1 min-h-20" value={story} onChange={(e) => setStory(e.target.value)} placeholder="How you made it, in your words." aria-label="Story" />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.published ? (
          <>
            <button className="btn-seal" data-testid="publish" disabled={!!busy || !dirty} onClick={() => publish(true)}>{busy ?? "Save changes"}</button>
            <button className="btn-ghost" disabled={!!busy} onClick={() => publish(false)}>Make it private</button>
          </>
        ) : (
          <button className="btn-seal" data-testid="publish" disabled={!!busy} onClick={() => publish(true)}>{busy ?? "Publish the page"}</button>
        )}
        <Link className="btn-ghost" href={`/p/${piece.piece_id}`}>Open it</Link>
      </div>
      {data.published && !dirty && <p className="mt-2 text-sm text-ink-3">Published.</p>}
      <ErrorNote error={error} />
    </Section>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import type { PieceInfo } from "@/lib/piece";
import { ErrorNote, Section, useAction } from "@/components/ui";
import { useEvidence } from "@/lib/evidence";

/** The proof page is private until the artist publishes it (DESIGN §4). */
export function PublishPanel({ piece }: { piece: PieceInfo }) {
  const evidence = useEvidence();
  const [published, setPublished] = useState<boolean | null>(null);
  const [story, setStory] = useState("");
  const { busy, error, run } = useAction();
  if (!piece.report_hash) return null;
  const set = (v: boolean) => run("Saving", async () => setPublished((await evidence("POST", `/pieces/${piece.piece_id}/publish`, { published: v })).published));
  return (
    <Section title="Proof page">
      <p className="text-sm text-ink-2">Publishing shows the facts of your record, the frames you marked for the proof page and your story. Never the price.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-seal" data-testid="publish" disabled={!!busy} onClick={() => set(true)}>Publish the proof page</button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => set(false)}>Make it private</button>
        <Link className="btn-ghost" href={`/p/${piece.piece_id}`}>Open it</Link>
      </div>
      <label className="mt-4 block">
        <span className="label">Your story (shown on the proof page)</span>
        <textarea className="field mt-1 min-h-20" value={story} onChange={(e) => setStory(e.target.value)} placeholder="How you made it, in your words." />
      </label>
      <button className="btn-ghost mt-2" disabled={!story.trim() || !!busy} onClick={() => run("Saving", async () => { await evidence("POST", `/pieces/${piece.piece_id}/story`, { text: story }); setStory(""); })}>
        Save story
      </button>
      {published !== null && <p className="mt-2 text-sm text-ink-3">{published ? "Published." : "Private."}</p>}
      <ErrorNote error={error} />
    </Section>
  );
}

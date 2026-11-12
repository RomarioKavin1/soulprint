"use client";
import { useNear } from "@/components/NearProvider";
import { usePoll } from "@/components/ui";
import { NoteCard } from "@/components/notes/ContextNotes";
import { useEvidence } from "@/lib/evidence";
import type { ContextNote } from "@/lib/context-notes";

/** How reader notes work, and the queue of notes waiting for ratings. */
export default function NotesPage() {
  const { accountId } = useNear();
  const evidence = useEvidence();
  const { data, reload } = usePoll(
    () => evidence<{ notes: ContextNote[] }>("GET", "/context-notes/needs-ratings", undefined, { anonymous: true }),
    10_000,
    [],
  );
  return (
    <div className="space-y-8 pt-10">
      <header>
        <p className="label">Reader notes</p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl tracking-tight">Questions about a record are rated, not shouted.</h1>
      </header>
      <section className="card max-w-3xl space-y-3 text-sm">
        <p>
          No one can tell for certain from a picture whether it was made with AI — not people, and not detectors. What a record can do is
          show how a piece came together. When something in it does not add up, anyone can <b>ask about it</b> on the piece&apos;s page:
          say what they saw and, if they like, ask the artist for more evidence.
        </p>
        <p>
          A note is <b>not shown</b> to visitors until at least three other people have rated it, and two thirds of them found it helpful. If
          most find it unhelpful, it stays hidden. The artist can answer any note, and raters can change their minds after the answer. The
          artist cannot rate notes on their own work, and nobody can rate their own note.
        </p>
        <p>
          A shown note never changes the evidence level: the level is computed from the record alone. A shown note reads as context —
          &ldquo;readers asked about this&rdquo; — next to the artist&apos;s answer, never as a verdict.
        </p>
        <p className="text-ink-3">
          Limits: accounts are cheap to create, so a determined group can push a note up or down; ratings are counted, not yet weighted
          by how raters have agreed in the past. Treat notes as a prompt to look closer, not as proof.
        </p>
      </section>

      <section>
        <h2 className="font-display text-2xl">Waiting for ratings</h2>
        {!accountId && <p className="mt-2 text-sm text-ink-2">Sign in to rate.</p>}
        {!data ? (
          <p className="mt-4 text-ink-3">Loading…</p>
        ) : data.notes.length === 0 ? (
          <p className="mt-4 text-ink-2" data-testid="queue-empty">No notes are waiting for ratings.</p>
        ) : (
          <ul className="mt-4 space-y-4" data-testid="queue">
            {data.notes.map((n) => (
              <NoteCard key={n.id} note={n} pieceId={n.pieceId} viewer={accountId} isArtist={false} onChange={reload} showPiece />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

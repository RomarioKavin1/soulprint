"use client";
import { useNear } from "@/components/NearProvider";
import { usePoll } from "@/components/ui";
import { NoteCard } from "@/components/notes/ContextNotes";
import { useEvidence } from "@/lib/evidence";
import type { ContextNote } from "@/lib/context-notes";

/** How reader questions work, and (signed in) the questions waiting for ratings. */
export default function NotesPage() {
  const { accountId } = useNear();
  return (
    <div className="space-y-8 pt-10">
      <header>
        <p className="label">Reader questions</p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl tracking-tight">Questions about a record are rated, not shouted.</h1>
      </header>
      <section className="card max-w-3xl space-y-3 text-sm">
        <p>
          No one can tell for certain from a picture whether it was made with AI — not people, and not detectors. What a record can do is
          show how a piece came together. When something in it does not add up, anyone signed in can <b>ask about it</b> on the piece&apos;s
          page: say what they noticed and what would settle it — more frames of the making, a live check on the next piece, the layered
          working file, or a photo of the physical work.
        </p>
        <p>
          Visitors see a question only after <b>at least five readers</b> have rated it and <b>four in five</b> found it useful. If two or
          more readers say it is about the person rather than the work, it is hidden at once. When readers disagree it stays hidden and is
          labelled that way. The artist can answer any question; when they make more of the making public, the question says so. Raters can
          change their minds after the answer. Nobody rates their own question, and artists do not rate questions about their own work.
        </p>
        <p>
          A question never changes the evidence level, which is computed from the record alone, and it is always shown as a reader&apos;s
          question next to the artist&apos;s answer — never as a verdict. Authors can withdraw their questions; anyone can report one; the
          operators can remove questions that attack a person or share private information, and every removal is logged.
        </p>
        <p className="text-ink-3">
          Limits: accounts are cheap to create, so a determined group can still push a question up or down. Ratings are counted, not yet
          weighted by how raters have agreed in the past. Treat a question as a prompt to look closer, not as proof.
        </p>
      </section>
      {accountId ? <Queue accountId={accountId} /> : <p className="text-ink-2" data-testid="queue-signed-out">Sign in to see questions waiting for ratings.</p>}
    </div>
  );
}

function Queue({ accountId }: { accountId: string }) {
  const evidence = useEvidence();
  const { data, reload } = usePoll(() => evidence<{ notes: ContextNote[] }>("GET", "/context-notes/needs-ratings"), 10_000, [accountId]);
  return (
    <section>
      <h2 className="font-display text-2xl">Waiting for ratings</h2>
      <p className="mt-1 text-sm text-ink-3">Questions on other people&apos;s work that need more ratings. None of these are shown to visitors yet.</p>
      {!data ? (
        <p className="mt-4 text-ink-3">Loading…</p>
      ) : data.notes.length === 0 ? (
        <p className="mt-4 text-ink-2" data-testid="queue-empty">No questions are waiting for your rating.</p>
      ) : (
        <ul className="mt-4 space-y-4" data-testid="queue">
          {data.notes.map((n) => (
            <NoteCard key={n.id} note={n} viewer={accountId} artist={n.artist} onChange={reload} showPiece />
          ))}
        </ul>
      )}
    </section>
  );
}

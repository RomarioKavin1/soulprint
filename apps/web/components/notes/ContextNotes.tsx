"use client";
import Link from "next/link";
import { useState } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, useAction, usePoll } from "@/components/ui";
import { useEvidence } from "@/lib/evidence";
import { addedSince, CONCERN_TEXT, HELPFUL_TEXT, NOTE_MIN_CHARS, ratingLine, UNHELPFUL_TEXT, type Concern, type ContextNote } from "@/lib/context-notes";

/**
 * Notes from readers on a published piece. Visitors see notes people rated helpful, with the
 * artist's answer. Signed-in people can add a note, rate others' notes, and see every note and
 * where it stands. The artist answers here.
 */
export function ContextNotes({ pieceId, artist }: { pieceId: string; artist: string }) {
  const { accountId } = useNear();
  const evidence = useEvidence();
  const { data, reload } = usePoll(
    () => evidence<{ notes: ContextNote[]; publicFrames: number }>("GET", `/pieces/${pieceId}/context-notes`, undefined, { anonymous: !accountId }),
    8000,
    [pieceId, accountId],
  );
  if (!data) return null;
  const isArtist = accountId === artist;
  const shown = data.notes.filter((n) => n.status === "shown");
  const pending = data.notes.filter((n) => n.status === "needs_ratings");
  const hidden = data.notes.filter((n) => n.status === "not_shown");
  const wroteOne = data.notes.some((n) => n.author === accountId);

  return (
    <section className="card" id="notes" data-testid="context-notes">
      <h2 className="font-display text-xl">Notes from readers</h2>
      <p className="mt-1 text-sm text-ink-2">
        Nobody can tell for certain from a picture whether it was made with AI. Readers can ask about the record, the artist can answer,
        and a note appears here once enough other people rate it helpful. Notes never change what the record itself shows.
      </p>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3" data-testid="no-shown-notes">No reader notes are shown on this piece.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} pieceId={pieceId} viewer={accountId} isArtist={isArtist} artist={artist} onChange={reload} />
          ))}
        </ul>
      )}

      {accountId && pending.length > 0 && (
        <Fold className="mt-5" initiallyOpen={isArtist || pending.some((n) => n.author !== accountId && !n.myRating)}
          summary={<span className="text-sm font-medium">Waiting for ratings ({pending.length}) — not shown to visitors yet</span>}>
          <ul className="mt-3 space-y-4">
            {pending.map((n) => (
              <NoteCard key={n.id} note={n} pieceId={pieceId} viewer={accountId} isArtist={isArtist} artist={artist} onChange={reload} />
            ))}
          </ul>
        </Fold>
      )}
      {accountId && hidden.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-ink-3">Rated not helpful ({hidden.length})</summary>
          <ul className="mt-3 space-y-4">
            {hidden.map((n) => (
              <NoteCard key={n.id} note={n} pieceId={pieceId} viewer={accountId} isArtist={isArtist} artist={artist} onChange={reload} />
            ))}
          </ul>
        </details>
      )}

      {!accountId ? (
        <p className="mt-5 text-sm text-ink-2">Sign in to add a note or rate notes. <Link className="underline" href="/notes">How notes work</Link></p>
      ) : isArtist ? (
        <p className="mt-5 text-sm text-ink-3">You can answer any note on your piece. Showing more of the making (frames, a live check on your next session) helps more than words.</p>
      ) : wroteOne ? null : (
        <AddNote pieceId={pieceId} onAdded={reload} />
      )}
    </section>
  );
}

/** A <details> that keeps whatever the reader chose (a controlled `open` would snap shut on every poll). */
function Fold({ initiallyOpen, summary, className, children }: { initiallyOpen: boolean; summary: React.ReactNode; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer">{summary}</summary>
      {children}
    </details>
  );
}

function AddNote({ pieceId, onAdded }: { pieceId: string; onAdded: () => void }) {
  const evidence = useEvidence();
  const [open, setOpen] = useState(false);
  const [concern, setConcern] = useState<Concern>("ai_generated");
  const [body, setBody] = useState("");
  const [asks, setAsks] = useState(true);
  const { busy, error, run } = useAction();
  if (!open)
    return (
      <button className="btn-ghost mt-5" data-testid="add-note" onClick={() => setOpen(true)}>
        Ask about this record
      </button>
    );
  return (
    <div className="mt-5 rounded-xl border border-rule bg-paper-2/50 p-4" data-testid="note-form">
      <p className="text-sm">
        Say what you saw in <i>this record</i> — which frames, what changed, what is missing — and what would settle it. Notes about the person,
        or guesses without details, are usually rated down.
      </p>
      <label className="mt-3 block">
        <span className="label block">What is your question about?</span>
        <select className="field mt-1 w-auto" value={concern} onChange={(e) => setConcern(e.target.value as Concern)} aria-label="Concern">
          {(Object.keys(CONCERN_TEXT) as Concern[]).map((c) => (
            <option key={c} value={c}>{CONCERN_TEXT[c]}</option>
          ))}
        </select>
      </label>
      <label className="mt-3 block">
        <span className="label block">What you observed</span>
        <textarea className="field mt-1 min-h-28" value={body} onChange={(e) => setBody(e.target.value)} aria-label="What you observed"
          placeholder="For example: between frames 12 and 13 the whole background appears at once, with no sketch underneath." />
        <span className={`mt-1 block text-xs ${body.trim().length < NOTE_MIN_CHARS ? "text-ink-3" : "text-moss"}`}>
          {body.trim().length < NOTE_MIN_CHARS ? `At least ${NOTE_MIN_CHARS} characters (${body.trim().length} so far).` : "Specific enough to send."}
        </span>
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={asks} onChange={(e) => setAsks(e.target.checked)} /> Ask the artist for more evidence
      </label>
      <div className="mt-4 flex gap-2">
        <button
          className="btn-primary"
          data-testid="send-note"
          disabled={!!busy || body.trim().length < NOTE_MIN_CHARS}
          onClick={() => run("Sending", async () => {
            await evidence("POST", `/pieces/${pieceId}/context-notes`, { concern, body: body.trim(), asksEvidence: asks });
            setOpen(false);
            setBody("");
            onAdded();
          })}
        >
          {busy ?? "Send the note for rating"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="mt-2 text-xs text-ink-3">Your note is shown on the piece only after other people rate it helpful. Your account name appears with it.</p>
      <ErrorNote error={error} />
    </div>
  );
}

export function NoteCard({ note: n, pieceId, viewer, isArtist, artist, onChange, showPiece = false }: {
  note: ContextNote; pieceId: string; viewer: string | null; isArtist: boolean; artist?: string; onChange: () => void; showPiece?: boolean;
}) {
  const evidence = useEvidence();
  const { busy, error, run } = useAction();
  const [reason, setReason] = useState("");
  const [answer, setAnswer] = useState("");
  const canRate = !!viewer && viewer !== n.author && !isArtist && viewer !== artist;
  const added = addedSince(n);
  const rate = (helpful: boolean, why: string) =>
    run("Saving", async () => {
      await evidence("POST", `/context-notes/${n.id}/ratings`, { helpful, reason: why });
      setReason("");
      onChange();
    });
  return (
    <li className={`rounded-xl border p-4 ${n.status === "shown" ? "border-amber/50 bg-amber/5" : "border-rule"}`} data-testid="note" data-status={n.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{CONCERN_TEXT[n.concern]}</p>
        <p className="text-xs text-ink-3" data-testid="note-rating">{ratingLine(n)}</p>
      </div>
      {showPiece && (
        <p className="mt-1 text-xs"><Link className="underline" href={`/p/${pieceId}`}>See the piece and its record</Link></p>
      )}
      <p className="mt-2 whitespace-pre-line text-sm">{n.body}</p>
      <p className="mt-1 text-xs text-ink-3">
        {n.author} · {new Date(n.createdAt).toLocaleDateString()}
        {n.asksEvidence ? " · asks the artist for more evidence" : ""}
      </p>
      {n.response && (
        <div className="mt-3 border-l-2 border-seal pl-3" data-testid="note-response">
          <p className="label">The artist answered</p>
          <p className="mt-1 whitespace-pre-line text-sm">{n.response.body}</p>
          {added && <p className="mt-1 text-xs text-moss">{added}</p>}
        </div>
      )}

      {canRate && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {n.myRating && <span className="text-xs text-ink-3">You rated it {n.myRating.helpful ? "helpful" : "not helpful"}. Change:</span>}
          <select className="field w-auto py-1 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why">
            <option value="">Rate this note…</option>
            <optgroup label="Helpful">
              {Object.entries(HELPFUL_TEXT).map(([k, v]) => <option key={k} value={`y:${k}`}>{v}</option>)}
            </optgroup>
            <optgroup label="Not helpful">
              {Object.entries(UNHELPFUL_TEXT).map(([k, v]) => <option key={k} value={`n:${k}`}>{v}</option>)}
            </optgroup>
          </select>
          <button className="btn-ghost py-1" data-testid="rate" disabled={!reason || !!busy} onClick={() => rate(reason.startsWith("y:"), reason.slice(2))}>
            {busy ?? "Rate"}
          </button>
        </div>
      )}

      {isArtist && (
        <div className="mt-3">
          <label className="block">
            <span className="label block">{n.response ? "Change your answer" : "Answer this note"}</span>
            <textarea className="field mt-1 min-h-20 text-sm" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Your answer"
              placeholder="What happened, and what you have added (more frames, the layered file, a live check next time)." />
          </label>
          <button className="btn-ghost mt-2 py-1" data-testid="answer" disabled={!answer.trim() || !!busy}
            onClick={() => run("Saving", async () => { await evidence("POST", `/context-notes/${n.id}/response`, { body: answer.trim() }); setAnswer(""); onChange(); })}>
            {busy ?? "Post the answer"}
          </button>
        </div>
      )}
      <ErrorNote error={error} />
    </li>
  );
}

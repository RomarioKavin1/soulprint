"use client";
import { fmtDate } from "@/lib/terms";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useNear } from "@/components/NearProvider";
import { ErrorNote, useAction, usePoll } from "@/components/ui";
import { useEvidence } from "@/lib/evidence";
import {
  CONCERN_QUESTION, CONCERN_TEXT, HELPFUL_TEXT, NOTE_MIN_CHARS, ratingLine, REPORT_TEXT, REQUEST_TEXT, requestLine, UNHELPFUL_TEXT,
  type Concern, type ContextNote, type EvidenceRequest,
} from "@/lib/context-notes";

/**
 * Reader questions on a published piece. Visitors who are not signed in see only questions readers
 * found useful, each with the artist's answer. Signed-in people also see questions waiting for
 * ratings, so they can rate them. The artist answers here; the author can withdraw; anyone can
 * report; operators can remove.
 */
export function ContextNotes({ pieceId, artist }: { pieceId: string; artist: string }) {
  const { accountId } = useNear();
  const evidence = useEvidence();
  const { data, reload } = usePoll(
    () => evidence<{ notes: ContextNote[]; canModerate: boolean }>("GET", `/pieces/${pieceId}/context-notes`, undefined, { anonymous: !accountId }),
    8000,
    [pieceId, accountId],
  );
  if (!data) return null;
  const isArtist = accountId === artist;
  const shown = data.notes.filter((n) => n.status === "shown");
  const pending = data.notes.filter((n) => n.status === "needs_ratings" || n.status === "disagree");
  const hidden = data.notes.filter((n) => n.status === "not_shown");
  const wroteOne = data.notes.some((n) => n.author === accountId);
  const card = (n: ContextNote) => (
    <NoteCard key={n.id} note={n} viewer={accountId} artist={artist} canModerate={data.canModerate} onChange={reload} />
  );

  return (
    <section className="card" id="notes" data-testid="context-notes">
      <h2 className="title-section">Questions from readers</h2>
      <p className="mt-1 text-sm text-ink-2">
        Nobody can tell for certain from a picture whether it was made with AI. Readers can ask about this record and ask for more of it; the
        artist can answer. A question appears here only when most readers who rated it found it useful. It never changes what the record shows.
      </p>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3" data-testid="no-shown-notes">No reader questions are shown on this piece.</p>
      ) : (
        <ul className="mt-4 space-y-4">{shown.map(card)}</ul>
      )}

      {accountId && pending.length > 0 && (
        <Fold className="mt-5" initiallyOpen={isArtist || pending.some((n) => n.author === accountId || !n.myRating)}
          summary={<span className="text-sm font-medium">Waiting for ratings ({pending.length}) — not shown to visitors</span>}>
          <ul className="mt-3 space-y-4">{pending.map(card)}</ul>
        </Fold>
      )}
      {accountId && hidden.length > 0 && (
        <Fold className="mt-3" initiallyOpen={hidden.some((n) => n.author === accountId || !!n.myRating)} summary={<span className="text-sm text-ink-3">Not shown: readers did not find these useful ({hidden.length})</span>}>
          <ul className="mt-3 space-y-4">{hidden.map(card)}</ul>
        </Fold>
      )}

      {!accountId ? (
        <p className="mt-5 text-sm text-ink-2">Sign in to ask a question or rate questions. <Link className="underline" href="/notes">How reader questions work</Link></p>
      ) : isArtist ? (
        <p className="mt-5 text-sm text-ink-3">You can answer any question about your piece. Showing more of the making (frames, a live check on your next piece) settles more than words.</p>
      ) : wroteOne ? null : (
        <AddNote pieceId={pieceId} onAdded={reload} />
      )}
    </section>
  );
}

/** A <details> that keeps whatever the reader chose (a controlled `open` would snap shut on every poll). */
function Fold({ initiallyOpen, summary, className, children }: { initiallyOpen: boolean; summary: ReactNode; className?: string; children: ReactNode }) {
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
  const [request, setRequest] = useState<EvidenceRequest>("more_frames");
  const { busy, error, run } = useAction();
  if (!open)
    return (
      <button className="btn-ghost mt-5" data-testid="add-note" onClick={() => setOpen(true)}>
        Ask about this record
      </button>
    );
  return (
    <div className="mt-5 rounded-sm border border-rule bg-paper-2/50 p-4" data-testid="note-form">
      <p className="text-sm">
        Ask about <i>this record</i>: say which frames or details made you wonder, and what would settle it. Questions about the person, or
        guesses without details, are rated down and hidden.
      </p>
      <label className="mt-3 block">
        <span className="label block">Your question is about</span>
        <select className="field mt-1 w-auto" value={concern} onChange={(e) => setConcern(e.target.value as Concern)} aria-label="Concern">
          {(Object.keys(CONCERN_TEXT) as Concern[]).map((c) => (
            <option key={c} value={c}>{CONCERN_TEXT[c]}</option>
          ))}
        </select>
      </label>
      <label className="mt-3 block">
        <span className="label block">What you noticed</span>
        <textarea className="field mt-1 min-h-28" value={body} onChange={(e) => setBody(e.target.value)} aria-label="What you observed"
          placeholder="For example: between the second and third public frames the whole background appears at once, with no sketch underneath." />
        <span className={`mt-1 block text-xs ${body.trim().length < NOTE_MIN_CHARS ? "text-ink-3" : "text-moss"}`}>
          {body.trim().length < NOTE_MIN_CHARS ? `At least ${NOTE_MIN_CHARS} characters (${body.trim().length} so far).` : "Specific enough to send."}
        </span>
      </label>
      <fieldset className="mt-3">
        <legend className="label">What would help settle it?</legend>
        <div className="mt-1 grid gap-1 text-sm">
          {(Object.keys(REQUEST_TEXT) as EvidenceRequest[]).map((r) => (
            <label key={r} className="flex items-start gap-2">
              <input type="radio" name="request" className="mt-1" checked={request === r} onChange={() => setRequest(r)} /> {REQUEST_TEXT[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex gap-2">
        <button
          className="btn-primary"
          data-testid="send-note"
          disabled={!!busy || body.trim().length < NOTE_MIN_CHARS}
          onClick={() => run("Sending", async () => {
            await evidence("POST", `/pieces/${pieceId}/context-notes`, { concern, body: body.trim(), request });
            setOpen(false);
            setBody("");
            onAdded();
          })}
        >
          {busy ?? "Send the question for rating"}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="mt-2 text-xs text-ink-3">Visitors see your question only after at least five readers rate it and most find it useful. Your account name appears with it. You can withdraw it at any time.</p>
      <ErrorNote error={error} />
    </div>
  );
}

export function NoteCard({ note: n, viewer, artist, canModerate = false, onChange, showPiece = false }: {
  note: ContextNote; viewer: string | null; artist: string | null; canModerate?: boolean; onChange: () => void; showPiece?: boolean;
}) {
  const evidence = useEvidence();
  const { busy, error, run } = useAction();
  const [reason, setReason] = useState("");
  const [answer, setAnswer] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const isArtist = !!viewer && viewer === (artist ?? n.artist);
  const isAuthor = viewer === n.author;
  const canRate = !!viewer && !isAuthor && !isArtist;
  const req = requestLine(n);
  const tone = n.status !== "shown" ? "border-rule" : n.response || req?.met ? "border-rule bg-paper-2/40" : "border-amber/50 bg-amber/5";
  const rate = (helpful: boolean, why: string) =>
    run("Saving", async () => {
      await evidence("POST", `/context-notes/${n.id}/ratings`, { helpful, reason: why });
      setReason("");
      onChange();
    });
  return (
    <li className={`rounded-sm border p-4 ${tone}`} data-testid="note" data-status={n.status}>
      <p className="label">A reader asked</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg" data-testid="note-question">{CONCERN_QUESTION[n.concern]}</p>
        <p className="text-xs text-ink-3" data-testid="note-rating">{ratingLine(n)}</p>
      </div>
      {showPiece && (
        <p className="mt-1 text-xs"><Link className="underline" href={`/p/${n.pieceId}`}>See the piece and its record</Link></p>
      )}
      <p className="mt-2 whitespace-pre-line text-sm">{n.body}</p>
      <p className="mt-1 text-xs text-ink-3">{n.author} · {fmtDate(n.createdAt, "date")}</p>
      {req && <p className={`mt-2 text-sm ${req.met ? "text-moss" : "text-ink-2"}`} data-testid="note-request">{req.text}</p>}
      {n.response && (
        <div className="mt-3 ml-1 border-t border-rule pt-3 pl-4" data-testid="note-response">
          <p className="label">The artist answered</p>
          <p className="mt-1 whitespace-pre-line text-sm">{n.response.body}</p>
        </div>
      )}

      {canRate && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {n.myRating && <span className="text-xs text-ink-3">You rated it {n.myRating.helpful ? "useful" : "not useful"}. Change:</span>}
          <select className="field w-auto py-1 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why">
            <option value="">Rate this question…</option>
            <optgroup label="Useful">
              {Object.entries(HELPFUL_TEXT).map(([k, v]) => <option key={k} value={`y:${k}`}>{v}</option>)}
            </optgroup>
            <optgroup label="Not useful">
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
            <span className="label block">{n.response ? "Change your answer" : "Answer this question"}</span>
            <textarea className="field mt-1 min-h-20 text-sm" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Your answer"
              placeholder="What happened, and what you have added (more frames, the layered file, a live check next time)." />
          </label>
          <button className="btn-ghost mt-2 py-1" data-testid="answer" disabled={!answer.trim() || !!busy}
            onClick={() => run("Saving", async () => { await evidence("POST", `/context-notes/${n.id}/response`, { body: answer.trim() }); setAnswer(""); onChange(); })}>
            {busy ?? "Post the answer"}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {isAuthor && (
          <button className="text-ink-3 underline" data-testid="withdraw" disabled={!!busy}
            onClick={() => run("Withdrawing", async () => { await evidence("POST", `/context-notes/${n.id}/withdraw`, {}); onChange(); })}>
            Withdraw my question
          </button>
        )}
        {viewer && !isAuthor && !reported && (
          reporting ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink-3">Report because it</span>
              {Object.entries(REPORT_TEXT).map(([k, v]) => (
                <button key={k} className="underline" data-testid={`report-${k}`} disabled={!!busy}
                  onClick={() => run("Reporting", async () => { await evidence("POST", `/context-notes/${n.id}/report`, { reason: k }); setReported(true); setReporting(false); })}>
                  {v.toLowerCase()}
                </button>
              ))}
              <button className="text-ink-3" onClick={() => setReporting(false)}>cancel</button>
            </span>
          ) : (
            <button className="text-ink-3 underline" data-testid="report" onClick={() => setReporting(true)}>Report</button>
          )
        )}
        {reported && <span className="text-ink-3" role="status">Reported to the operators. Thank you.</span>}
        {canModerate && (
          <button className="text-seal-2 underline" data-testid="remove" disabled={!!busy}
            onClick={() => run("Removing", async () => { await evidence("POST", `/context-notes/${n.id}/remove`, { reason: "personal_attack" }); onChange(); })}>
            Remove (operator)
          </button>
        )}
      </div>
      <ErrorNote error={error} />
    </li>
  );
}

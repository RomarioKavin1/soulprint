/**
 * Context notes (13 Nov): a community-notes style way to question a piece's record.
 *
 * Nobody can tell for certain from pixels whether a picture is AI-generated, so a note never
 * labels a piece. It is a reader's question with what they observed, optionally asking the artist
 * for more evidence. The artist can answer. Other people rate notes; a note is shown to visitors
 * only once enough raters found it helpful, and a note found unhelpful is hidden. The evidence
 * level (computed from the record) is never changed by notes.
 */
export const CONCERNS = ["ai_generated", "process_mismatch", "copied", "other"] as const;
export type Concern = (typeof CONCERNS)[number];

export const HELPFUL_REASONS = ["specific_details", "names_useful_evidence", "fair_tone"] as const;
export const UNHELPFUL_REASONS = ["speculation", "personal_attack", "ignores_the_record", "artist_answered"] as const;

export const NOTE_RULES = {
  minBody: 40,
  maxBody: 1000,
  maxResponse: 1000,
  /** Ratings needed before a note can be shown or hidden. */
  minRatings: 3,
  /** Shown when at least this share of ratings found it helpful… */
  showShare: 2 / 3,
  /** …hidden when at most this share did. */
  hideShare: 1 / 3,
  /** Per author, rolling 24 h. */
  maxNotesPerDay: 5,
} as const;

export type NoteStatus = "needs_ratings" | "shown" | "not_shown";

export function noteStatus(helpful: number, total: number): NoteStatus {
  if (total < NOTE_RULES.minRatings) return "needs_ratings";
  const share = helpful / total;
  if (share >= NOTE_RULES.showShare) return "shown";
  if (share <= NOTE_RULES.hideShare) return "not_shown";
  return "needs_ratings";
}

/** SQL predicate for "shown", kept equal to `noteStatus` (counts in integers). */
export const SHOWN_SQL = (helpful: string, total: string) =>
  `(${total} >= ${NOTE_RULES.minRatings} AND ${helpful} * 3 >= ${total} * 2)`;

export class NoteError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export function validateNote(b: any): { concern: Concern; body: string; asksEvidence: boolean } {
  const concern = String(b?.concern ?? "");
  if (!(CONCERNS as readonly string[]).includes(concern)) throw new NoteError(400, "bad_concern");
  const body = String(b?.body ?? "").trim();
  if (body.length < NOTE_RULES.minBody) throw new NoteError(400, "note_too_short");
  if (body.length > NOTE_RULES.maxBody) throw new NoteError(400, "note_too_long");
  return { concern: concern as Concern, body, asksEvidence: b?.asksEvidence === true };
}

export function validateRating(b: any): { helpful: boolean; reason: string } {
  if (typeof b?.helpful !== "boolean") throw new NoteError(400, "bad_rating");
  const reason = String(b?.reason ?? "");
  const allowed: readonly string[] = b.helpful ? HELPFUL_REASONS : UNHELPFUL_REASONS;
  if (!allowed.includes(reason)) throw new NoteError(400, "bad_reason");
  return { helpful: b.helpful, reason };
}

export function validateResponse(b: any): string {
  const body = String(b?.body ?? "").trim();
  if (!body) throw new NoteError(400, "response_empty");
  if (body.length > NOTE_RULES.maxResponse) throw new NoteError(400, "response_too_long");
  return body;
}

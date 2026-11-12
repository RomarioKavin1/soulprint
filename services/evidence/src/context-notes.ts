/**
 * Reader notes (13 Nov; tightened after critique/fable-notes-review.md).
 *
 * Nobody can tell for certain from pixels whether a picture was made with AI, so a note never
 * labels a piece. It is a reader's question about the record, with what they observed and,
 * optionally, a concrete request for more evidence. The artist can answer. Other people rate
 * notes; a note is shown to visitors only when clearly found useful, and is hidden quickly when
 * raters say it is about the person rather than the work. The evidence level is never changed.
 *
 * Showing is deliberately harder than hiding (a wrongly shown note harms a person; a wrongly
 * hidden one only delays a question). Known limit: ratings are counted, not bridged by rater
 * history, so a group of accounts can still push a note; the thresholds raise the cost.
 */
export const CONCERNS = ["ai_generated", "process_mismatch", "copied", "other"] as const;
export type Concern = (typeof CONCERNS)[number];

/** What the reader asks the artist for. `more_frames` resolves by itself when more frames go public. */
export const REQUESTS = ["none", "more_frames", "live_check", "source_file", "photo"] as const;
export type EvidenceRequest = (typeof REQUESTS)[number];

export const HELPFUL_REASONS = ["specific_details", "names_useful_evidence", "fair_tone"] as const;
export const UNHELPFUL_REASONS = ["speculation", "personal_attack", "ignores_the_record", "artist_answered"] as const;
export const REPORT_REASONS = ["personal_attack", "private_information", "spam", "other"] as const;

export const NOTE_RULES = {
  minBody: 40,
  maxBody: 1000,
  maxResponse: 1000,
  /** Ratings needed before a note can be shown, hidden for being unhelpful, or called disputed. */
  minRatings: 5,
  /** Shown only when at least this share of ratings found it helpful. */
  showShare: 0.8,
  /** Hidden when at most this share did. Between the two: "readers disagree", not shown. */
  hideShare: 0.4,
  /** This many "about the person, not the work" ratings hide a note at once, whatever the rest say. */
  personalAttackHide: 2,
  /** Per author, rolling 24 h. */
  maxNotesPerDay: 5,
} as const;

export type NoteStatus = "needs_ratings" | "shown" | "disagree" | "not_shown";

export function noteStatus(helpful: number, total: number, personalAttacks = 0): NoteStatus {
  if (personalAttacks >= NOTE_RULES.personalAttackHide) return "not_shown";
  if (total < NOTE_RULES.minRatings) return "needs_ratings";
  const share = helpful / total;
  if (share >= NOTE_RULES.showShare) return "shown";
  if (share <= NOTE_RULES.hideShare) return "not_shown";
  return "disagree";
}

export class NoteError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export function validateNote(b: any): { concern: Concern; body: string; request: EvidenceRequest } {
  const concern = String(b?.concern ?? "");
  if (!(CONCERNS as readonly string[]).includes(concern)) throw new NoteError(400, "bad_concern");
  const body = String(b?.body ?? "").trim();
  if (body.length < NOTE_RULES.minBody) throw new NoteError(400, "note_too_short");
  if (body.length > NOTE_RULES.maxBody) throw new NoteError(400, "note_too_long");
  const request = String(b?.request ?? (b?.asksEvidence === true ? "more_frames" : "none"));
  if (!(REQUESTS as readonly string[]).includes(request)) throw new NoteError(400, "bad_request");
  return { concern: concern as Concern, body, request: request as EvidenceRequest };
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

export function validateReport(b: any): string {
  const reason = String(b?.reason ?? "");
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) throw new NoteError(400, "bad_reason");
  return reason;
}

/** `true`/`false` when the request can be checked from the record; `null` when only the artist's answer speaks to it. */
export function requestMet(request: string, publicFramesAtNote: number, publicFramesNow: number): boolean | null {
  if (request === "more_frames") return publicFramesNow > publicFramesAtNote;
  return null;
}

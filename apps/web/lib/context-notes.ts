/**
 * Reader notes: a reader asks about a record, the artist answers, others rate. Shown to visitors
 * only when clearly found useful (services/evidence/src/context-notes.ts has the rules).
 * Wording (critique/fable-notes-review.md): a note is always a reader's question in the reader's
 * voice, never the platform's verdict, and never calls a piece or a person fake.
 */
export type Concern = "ai_generated" | "process_mismatch" | "copied" | "other";
export type EvidenceRequest = "none" | "more_frames" | "live_check" | "source_file" | "photo";
export type NoteStatus = "needs_ratings" | "shown" | "disagree" | "not_shown";

export interface ContextNote {
  id: number;
  pieceId: string;
  artist: string | null;
  author: string;
  concern: Concern;
  body: string;
  request: EvidenceRequest;
  requestMet: boolean | null;
  createdAt: number;
  status: NoteStatus;
  ratings: { helpful: number; total: number };
  publicFramesAtNote: number;
  publicFramesNow: number;
  response: { body: string; at: number; publicFramesAtResponse: number } | null;
  myRating?: { helpful: boolean; reason: string } | null;
}

/** The reader's question, as a question. */
export const CONCERN_QUESTION: Record<Concern, string> = {
  ai_generated: "Could this have been made with AI?",
  process_mismatch: "Does the making match the finished piece?",
  copied: "Could this be copied or traced from another work?",
  other: "A question about this record",
};
/** Labels for the form's picker. */
export const CONCERN_TEXT: Record<Concern, string> = {
  ai_generated: "Whether it was made with AI",
  process_mismatch: "Whether the making matches the finished piece",
  copied: "Whether it was copied or traced from another work",
  other: "Something else about the record",
};

export const REQUEST_TEXT: Record<EvidenceRequest, string> = {
  none: "No request — just the question",
  more_frames: "Make more frames of the making public",
  live_check: "Do a live check on the next piece (a code to put in the work while recording)",
  source_file: "Share the layered working file with collectors",
  photo: "Show a photo of the physical work",
};
/** Short form used in the note itself. */
export const REQUEST_SHORT: Record<EvidenceRequest, string> = {
  none: "",
  more_frames: "more frames of the making",
  live_check: "a live check on the next piece",
  source_file: "the layered working file",
  photo: "a photo of the physical work",
};

export const HELPFUL_TEXT: Record<string, string> = {
  specific_details: "Points to specific details in the record",
  names_useful_evidence: "Asks for evidence that would settle it",
  fair_tone: "Fair and respectful",
};
export const UNHELPFUL_TEXT: Record<string, string> = {
  speculation: "Guesswork, nothing specific",
  ignores_the_record: "Ignores what the record already shows",
  personal_attack: "About the person, not the work",
  artist_answered: "The artist's answer settles it",
};
export const REPORT_TEXT: Record<string, string> = {
  personal_attack: "Attacks a person",
  private_information: "Shares private information",
  spam: "Spam or off-topic",
  other: "Something else",
};

export const NOTE_MIN_CHARS = 40;

export function ratingLine(n: Pick<ContextNote, "ratings" | "status">) {
  const { helpful, total } = n.ratings;
  if (n.status === "shown") return `${helpful} of ${total} readers found this question useful`;
  if (n.status === "disagree") return `Readers disagree (${helpful} of ${total} found it useful) — not shown to visitors`;
  if (n.status === "not_shown") return "Readers did not find this useful — not shown to visitors";
  return total === 0 ? "No ratings yet — not shown to visitors" : `${total} rating${total === 1 ? "" : "s"} so far — not shown to visitors yet`;
}

/** Where the reader's request stands. */
export function requestLine(n: ContextNote) {
  if (n.request === "none") return null;
  const what = REQUEST_SHORT[n.request];
  if (n.requestMet === true) {
    const more = n.publicFramesNow - n.publicFramesAtNote;
    return { met: true, text: `Asked for ${what}. The artist made ${more} more frame${more === 1 ? "" : "s"} public.` };
  }
  if (n.response) return { met: false, text: `Asked for ${what}. The artist answered below.` };
  return { met: false, text: `Asked for ${what}. Waiting for the artist.` };
}

/** Gallery badge: neutral, and says when the artist has answered. */
export function galleryBadge(notes: { shown: number; answered: number } | undefined) {
  if (!notes || notes.shown === 0) return null;
  return notes.answered >= notes.shown ? "The artist answered a reader's question" : "A reader asked a question";
}

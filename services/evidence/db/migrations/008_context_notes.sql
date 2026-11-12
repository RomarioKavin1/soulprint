-- Context notes (13 Nov): anyone can raise a question about a published piece's record
-- ("may be AI-generated", "the making does not match the final piece", …), ask the artist for more
-- evidence, and rate other people's notes. A note is shown on the piece only once enough raters
-- found it helpful (community-notes style); nobody is labelled "fake".
CREATE TABLE IF NOT EXISTS context_notes (
  id serial PRIMARY KEY,
  piece_id text NOT NULL,
  author text NOT NULL,
  concern text NOT NULL,
  body text NOT NULL,
  asks_evidence boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  -- Public frames on the piece when the note was written (so a response can show what was added).
  public_frames_at_note integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS context_notes_piece ON context_notes (piece_id, id);
CREATE INDEX IF NOT EXISTS context_notes_author ON context_notes (author, created_at);
CREATE TABLE IF NOT EXISTS context_note_ratings (
  note_id integer NOT NULL REFERENCES context_notes (id),
  rater text NOT NULL,
  helpful boolean NOT NULL,
  reason text NOT NULL,
  at bigint NOT NULL,
  PRIMARY KEY (note_id, rater)
);
CREATE TABLE IF NOT EXISTS context_note_responses (
  note_id integer PRIMARY KEY REFERENCES context_notes (id),
  body text NOT NULL,
  at bigint NOT NULL,
  public_frames_at_response integer NOT NULL DEFAULT 0
);

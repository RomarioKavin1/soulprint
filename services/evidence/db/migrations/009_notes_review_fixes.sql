-- Fixes from critique/fable-notes-review.md (13 Nov).
-- Structured evidence requests, author withdraw, operator removal (logged), reader reports.
ALTER TABLE context_notes ADD COLUMN IF NOT EXISTS request text NOT NULL DEFAULT 'none';
UPDATE context_notes SET request = 'more_frames' WHERE asks_evidence AND request = 'none';
ALTER TABLE context_notes ADD COLUMN IF NOT EXISTS withdrawn_at bigint;
ALTER TABLE context_notes ADD COLUMN IF NOT EXISTS removed_at bigint;
ALTER TABLE context_notes ADD COLUMN IF NOT EXISTS removed_by text;
ALTER TABLE context_notes ADD COLUMN IF NOT EXISTS removed_reason text;
CREATE TABLE IF NOT EXISTS context_note_reports (
  note_id integer NOT NULL REFERENCES context_notes (id),
  reporter text NOT NULL,
  reason text NOT NULL,
  at bigint NOT NULL,
  PRIMARY KEY (note_id, reporter)
);
-- B9: the finished work is shown on the piece page (a preview, not the full file) unless the artist
-- turns it off; an optional title.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS show_final boolean NOT NULL DEFAULT true;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS title text;

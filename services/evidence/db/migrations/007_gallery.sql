-- Showcase pivot (12 Nov): the public gallery lists published proof pages, newest first.
-- `artist` and `published_at` are written on publish; older published rows are filled lazily.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS artist text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS published_at bigint;
CREATE INDEX IF NOT EXISTS reports_gallery ON reports (published, published_at DESC);

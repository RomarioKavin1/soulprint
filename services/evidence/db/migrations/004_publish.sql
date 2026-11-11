-- Plan 3 Task 4: the proof page is private until the artist publishes it.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

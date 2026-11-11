-- A frame whose image already belongs to another piece is kept (the chain must continue) but
-- flagged, and counts for nothing in that piece's metrics (M8 intent without blocking capture).
ALTER TABLE frames ADD COLUMN IF NOT EXISTS reused boolean NOT NULL DEFAULT false;

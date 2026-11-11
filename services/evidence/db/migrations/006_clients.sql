-- Plan 2 review I7: the commission conversation (brief, messages, client-visible frames) belongs to
-- the artist and the commissioning client, pinned while the commission is live, not to later owners.
CREATE TABLE IF NOT EXISTS piece_clients (
  piece_id text PRIMARY KEY,
  account text NOT NULL
);

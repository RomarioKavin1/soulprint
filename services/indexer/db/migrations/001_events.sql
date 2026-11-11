CREATE TABLE IF NOT EXISTS blocks (height bigint PRIMARY KEY, ts_ms bigint NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  height bigint NOT NULL,
  idx int NOT NULL,
  piece_id text NOT NULL,
  event text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (height, idx)
);
CREATE INDEX IF NOT EXISTS events_piece ON events (piece_id, height, idx);
CREATE TABLE IF NOT EXISTS pieces (
  piece_id text PRIMARY KEY,
  token_id text NOT NULL,
  artist text NOT NULL,
  mode text NOT NULL,
  currency jsonb NOT NULL,
  created_height bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS holders (piece_id text PRIMARY KEY, owner text NOT NULL, seq bigint NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v text NOT NULL);

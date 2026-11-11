-- Evidence service schema (Plan 2 Task 3). Images live encrypted in the blob store.
CREATE TABLE IF NOT EXISTS piece_keys (
  piece_id text PRIMARY KEY,
  wrapped bytea NOT NULL
);
CREATE TABLE IF NOT EXISTS frames (
  piece_id text NOT NULL,
  key_hex text NOT NULL,
  idx integer NOT NULL,
  session_id text NOT NULL,
  device_ts bigint NOT NULL,
  jpeg_hash bytea NOT NULL,
  link bytea NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  blob_key text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'client', 'public')),
  discarded boolean NOT NULL DEFAULT false,
  received_at bigint NOT NULL,
  PRIMARY KEY (piece_id, key_hex, idx)
);
CREATE INDEX IF NOT EXISTS frames_jpeg_hash ON frames (jpeg_hash);
-- Capture-key-signed anchor candidates (one per uploaded batch head).
CREATE TABLE IF NOT EXISTS anchor_sigs (
  piece_id text NOT NULL,
  key_hex text NOT NULL,
  count integer NOT NULL,
  head bytea NOT NULL,
  sig bytea NOT NULL,
  PRIMARY KEY (piece_id, key_hex, count)
);
-- Anchors this service submitted (A35).
CREATE TABLE IF NOT EXISTS anchors (
  piece_id text NOT NULL,
  key_hex text NOT NULL,
  count integer NOT NULL,
  tx_hash text NOT NULL,
  at bigint NOT NULL,
  PRIMARY KEY (piece_id, key_hex, count)
);
CREATE TABLE IF NOT EXISTS files (
  id serial PRIMARY KEY,
  piece_id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  sha256 bytea NOT NULL,
  blob_key text NOT NULL,
  author text NOT NULL,
  at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id serial PRIMARY KEY,
  piece_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('story', 'brief', 'messages')),
  author text NOT NULL,
  body text NOT NULL,
  at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  nonce bytea PRIMARY KEY,
  at bigint NOT NULL
);

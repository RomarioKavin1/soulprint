-- Live challenges (A28). The code stays secret until the report; nonce_hash = sha256(code ‖ salt).
CREATE TABLE IF NOT EXISTS challenges (
  piece_id text NOT NULL,
  nonce_hash bytea PRIMARY KEY,
  code text NOT NULL,
  salt bytea NOT NULL,
  issuer text NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_piece ON challenges (piece_id);

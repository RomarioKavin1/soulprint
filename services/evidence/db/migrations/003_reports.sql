-- Built reports (Plan 2 Task 6). public_json is the exact JCS text whose sha256 is report_hash.
CREATE TABLE IF NOT EXISTS reports (
  piece_id text PRIMARY KEY,
  public_json text NOT NULL,
  report_hash bytea NOT NULL,
  final_file_hash bytea NOT NULL,
  level integer NOT NULL,
  capture_key bytea,
  anchor_head bytea,
  anchor_count integer,
  built_at bigint NOT NULL
);

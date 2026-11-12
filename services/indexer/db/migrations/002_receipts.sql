-- Transaction-API source (public networks): receipts already ingested, and transactions whose
-- receipts are all final, so late discoveries are appended once and never collide or repeat.
CREATE TABLE IF NOT EXISTS seen_receipts (rid text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS txs_done (hash text PRIMARY KEY);

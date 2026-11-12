-- Transaction-API source: per-account freshness. `polled_head` = chain head when the account was
-- last read; `active_height` = latest receipt seen for it; `wanted_ms` = last time someone opened it.
CREATE TABLE IF NOT EXISTS account_poll (
  account text PRIMARY KEY,
  polled_head bigint NOT NULL DEFAULT 0,
  active_height bigint NOT NULL DEFAULT 0,
  wanted_ms bigint NOT NULL DEFAULT 0
);

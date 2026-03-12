CREATE TABLE IF NOT EXISTS webhook_fortress_processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_fortress_event_locks (
  event_id TEXT PRIMARY KEY,
  lock_token TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_fortress_failures (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  error_message TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_fortress_failures_event_id_idx
  ON webhook_fortress_failures (event_id);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for system/webhook rows
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'acked', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at TEXT,
  lease_expires_at TEXT,
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedup
  ON outbox(tenant_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_claim
  ON outbox(status, available_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_outbox_agg ON outbox(aggregate_id);

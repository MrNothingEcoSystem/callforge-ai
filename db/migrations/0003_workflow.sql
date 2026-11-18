CREATE TABLE IF NOT EXISTS call_state_transitions (
  id TEXT PRIMARY KEY,
  call_intent_id TEXT NOT NULL REFERENCES call_intents(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('applied', 'rejected')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transitions_intent ON call_state_transitions(call_intent_id);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  signature TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  last_error TEXT,
  UNIQUE (provider, dedup_key)
);

CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  call_intent_id TEXT REFERENCES call_intents(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  limit_value INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, resource)
);

CREATE TABLE IF NOT EXISTS retention_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  retain_days INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, resource)
);

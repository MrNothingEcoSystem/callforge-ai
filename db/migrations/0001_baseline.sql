CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  settings TEXT DEFAULT '{}',
  compliance_status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS call_intents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT,
  to_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'dispatched', 'completed', 'failed', 'cancelled')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('ar', 'en')),
  voice_config TEXT DEFAULT '{}',
  business_context TEXT DEFAULT '{}',
  compliance_evidence TEXT DEFAULT '{}',
  approval_id TEXT,
  approval_expires_at TEXT,
  dispatched_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_intents_idempotency ON call_intents(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_call_intents_tenant ON call_intents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_intents_status ON call_intents(status);

CREATE TABLE IF NOT EXISTS call_events (
  id TEXT PRIMARY KEY,
  call_intent_id TEXT NOT NULL REFERENCES call_intents(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  provider_event_id TEXT,
  provider_name TEXT,
  sequence_number INTEGER NOT NULL DEFAULT 0,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_events_intent ON call_events(call_intent_id);
CREATE INDEX IF NOT EXISTS idx_call_events_sequence ON call_events(call_intent_id, sequence_number);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'user', 'agent', 'provider')),
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  payload TEXT DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_hash ON audit_events(event_hash);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);

CREATE TABLE IF NOT EXISTS business_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sector TEXT,
  business_name TEXT,
  license_number TEXT,
  license_expiry TEXT,
  supported_languages TEXT DEFAULT '["en"]',
  calling_hours TEXT DEFAULT '{"start": "09:00", "end": "21:00", "timezone": "Asia/Dubai"}',
  max_retries INTEGER DEFAULT 3,
  retry_cooldown_hours INTEGER DEFAULT 24,
  ai_disclosure_enabled INTEGER DEFAULT 1,
  recording_consent_required INTEGER DEFAULT 1,
  dncr_check_enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id)
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('ar', 'en')),
  tags TEXT DEFAULT '[]',
  embedding TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_language ON knowledge_entries(language);

CREATE TABLE IF NOT EXISTS conversation_fixtures (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('ar', 'en')),
  scenario TEXT NOT NULL,
  turns TEXT NOT NULL,
  expected_outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

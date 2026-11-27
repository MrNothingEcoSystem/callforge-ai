-- TECH-015 (M05 sink): one row per `call.dial` as handed to a telephony provider.
-- The unique dial_request_id is the idempotency guard: an at-least-once outbox
-- redelivery reuses the row instead of dialing twice. `provider_ref` is the
-- provider's handle for the call; `error` keeps the last failure for retry triage.
CREATE TABLE IF NOT EXISTS call_attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dial_request_id TEXT NOT NULL REFERENCES dial_requests(id) ON DELETE CASCADE,
  call_intent_id TEXT NOT NULL REFERENCES call_intents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dispatching'
    CHECK (status IN ('dispatching', 'accepted', 'failed')),
  provider_ref TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dial_request_id)
);

CREATE INDEX IF NOT EXISTS idx_call_attempts_intent ON call_attempts(call_intent_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_tenant_status ON call_attempts(tenant_id, status);

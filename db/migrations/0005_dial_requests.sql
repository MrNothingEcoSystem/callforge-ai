-- TECH-011: pending dial decisions, snapshotted so the decision is reproducible
-- at dispatch time (the outbox row and the policy read are separated by a lease).
-- status 'allowed' means one dial was authorised; its created_at is the attempt
-- clock the R10 ceiling reads. Denials are recorded, not retried.
CREATE TABLE IF NOT EXISTS dial_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_intent_id TEXT NOT NULL REFERENCES call_intents(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  campaign_kind TEXT NOT NULL,
  cli TEXT,
  purpose TEXT,
  phone TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  contact_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'allowed', 'denied')),
  reasons_json TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_dial_requests_phone
  ON dial_requests(tenant_id, phone, status, created_at);
CREATE INDEX IF NOT EXISTS idx_dial_requests_intent ON dial_requests(call_intent_id);

-- TECH-012: durable DNCR / consent fact sources, so the dial gate reads facts
-- from a source of record instead of trusting the caller's snapshot.
-- dncr_checks is a TTL cache of provider answers (the evaluator still denies
-- anything older than 24h); the reference records who answered.
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'withdrawn')),
  evidence_ref TEXT,
  granted_at TEXT NOT NULL,
  withdrawn_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, phone, purpose)
);

CREATE INDEX IF NOT EXISTS idx_consents_lookup ON consents(tenant_id, phone, purpose, status);

CREATE TABLE IF NOT EXISTS opt_outs (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('offer', 'global')),
  recorded_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (tenant_id, phone, scope)
);

CREATE TABLE IF NOT EXISTS dncr_checks (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('clean', 'listed', 'unknown')),
  checked_at TEXT NOT NULL,
  reference TEXT,
  PRIMARY KEY (tenant_id, phone)
);

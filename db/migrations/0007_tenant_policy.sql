-- TECH-013 (review #197 F4): the calling window, retry ceiling and DNCR
-- freshness rule are statutory defaults in code, but a tenant's approval and
-- Emirates differ. One row per tenant overrides them; absent row = defaults.
-- Values are re-validated on read (rows can be edited by hand), and an
-- out-of-range value denies rather than silently widening the gate.
CREATE TABLE IF NOT EXISTS tenant_policies (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  window_start_hour INTEGER NOT NULL DEFAULT 9 CHECK (window_start_hour BETWEEN 0 AND 24),
  window_end_hour INTEGER NOT NULL DEFAULT 18 CHECK (window_end_hour BETWEEN 0 AND 24),
  retry_limit_day INTEGER NOT NULL DEFAULT 2 CHECK (retry_limit_day BETWEEN 1 AND 10),
  retry_limit_week INTEGER NOT NULL DEFAULT 3 CHECK (retry_limit_week BETWEEN 1 AND 20),
  dncr_max_age_hours INTEGER NOT NULL DEFAULT 24 CHECK (dncr_max_age_hours BETWEEN 1 AND 168),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

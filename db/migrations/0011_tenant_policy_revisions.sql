-- TECH-014 (cycle-232 follow-up): the audit log records that a tenant policy
-- changed, but the log is not readable through the policy surface, so an
-- operator cannot see what the tenant's calling window was before a change.
-- One row per accepted write and per revert keeps that history queryable.
-- Append-only: a revert deletes `tenant_policies`, never these rows. The
-- snapshot is stored as JSON text and is nullable because a row that failed
-- validation can still be reverted (its violations are recorded instead).
CREATE TABLE IF NOT EXISTS tenant_policy_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('updated', 'reverted')),
  policy_json TEXT,
  violations_json TEXT NOT NULL DEFAULT '[]',
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_policy_revisions_tenant
  ON tenant_policy_revisions (tenant_id, id DESC);

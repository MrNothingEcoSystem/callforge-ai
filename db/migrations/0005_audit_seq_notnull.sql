-- TECH-004 hedge hardening - PR #196 review findings F3 (nullable `seq`) and F5
-- (O(n^2) COUNT(*) backfill).
--
-- 0004 introduced `seq` as a nullable column filled by an AFTER INSERT trigger.
-- An AFTER INSERT trigger can never satisfy NOT NULL (verified: the constraint is
-- evaluated before AFTER triggers run), so this migration rebuilds the table and
-- moves allocation into the INSERT statement itself. Both insert sites
-- (`audit.mjs`, `workflow/stateMachine.mjs`) supply
-- `(SELECT COALESCE(MAX(seq), 0) + 1 FROM audit_events)`, which is atomic inside
-- the single INSERT statement and stays inside the caller's transaction.
--
-- What changes:
--   * `seq INTEGER NOT NULL` - the ordering key can no longer be absent, so readers
--     cannot see an unorderable row. No CHECK: tests and repair jobs legitimately
--     force out-of-band values to prove readers ignore rowid.
--   * Backfill is dense and gap-free via ROW_NUMBER() over the authoritative
--     `seq` ordering (rowid only as tiebreak), preserving the reviewed order and
--     normalising any gaps a reordered chain left behind.
--   * The AFTER INSERT trigger is dropped; the allocator now lives in the INSERT.
--
-- SQLite has no ALTER COLUMN, so this is the standard 12-step table rebuild. No
-- table references `audit_events`, so the drop/rename is contained; the whole file
-- runs inside the runner's per-migration transaction. `seq` is not part of the hash
-- preimage, so existing chain heads stay valid across the rebuild.

CREATE TABLE audit_events_rebuild (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  seq INTEGER NOT NULL
);

INSERT INTO audit_events_rebuild (
  id, tenant_id, event_type, actor_type, actor_id, action, resource_type,
  resource_id, payload, previous_hash, event_hash, created_at, seq
)
SELECT
  id, tenant_id, event_type, actor_type, actor_id, action, resource_type,
  resource_id, payload, previous_hash, event_hash, created_at,
  ROW_NUMBER() OVER (ORDER BY seq, rowid)
FROM audit_events;

DROP TABLE audit_events;

ALTER TABLE audit_events_rebuild RENAME TO audit_events;

CREATE UNIQUE INDEX idx_audit_events_seq ON audit_events(seq);
CREATE INDEX idx_audit_events_tenant ON audit_events(tenant_id);
CREATE INDEX idx_audit_events_hash ON audit_events(event_hash);
CREATE INDEX idx_audit_events_created ON audit_events(created_at);

DROP TRIGGER IF EXISTS trg_audit_events_seq;

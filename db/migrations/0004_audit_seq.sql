-- TECH-004 hedge (D-008): engine-neutral monotonic ordering key for the audit chain.
--
-- The hash chain's only portable ordering key today is rowid, which SQLite owns and
-- PostgreSQL does not reproduce in kind (ctid is unstable under UPDATE/VACUUM). This
-- adds an explicit, monotonic `seq` so every reader orders by seq and a future port
-- only has to swap the allocator (a real sequence/BIGSERIAL default), not the readers.
--
-- Allocation lives in a trigger because SQLite has no sequence object; it runs inside
-- the same write transaction as the INSERT, so seq stays gap-free and single-writer
-- claim-preserving. Backfill keeps existing rows ordered by their current rowid.

ALTER TABLE audit_events ADD COLUMN seq INTEGER;

UPDATE audit_events
   SET seq = (
     SELECT COUNT(*) FROM audit_events AS older WHERE older.rowid <= audit_events.rowid
   )
 WHERE seq IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_seq ON audit_events(seq);

CREATE TRIGGER IF NOT EXISTS trg_audit_events_seq
AFTER INSERT ON audit_events
WHEN NEW.seq IS NULL
BEGIN
  UPDATE audit_events
     SET seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM audit_events)
   WHERE id = NEW.id;
END;

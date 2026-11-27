-- TECH-014 (cycle-233): a PUT is a blind upsert, so two operators editing the
-- same tenant policy both get 200 and the earlier edit vanishes with no signal
-- to whoever made it. A monotonic version lets a caller fence its write: send
-- the version it read, and a superseded PUT is rejected as 409 instead of
-- silently overwriting. Absent version = old last-write-wins behaviour.
-- The counter is per row and never reused except across a revert (which
-- deletes the row), so a stale client cannot pass off an old number.
ALTER TABLE tenant_policies ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- TECH-015 F3 (M05 sink): claim lease so two dispatcher workers cannot both dial.
-- `claim_token` identifies the worker holding the in-flight dial, and `claimed_at`
-- bounds the lease: a `dispatching` row is reclaimable once its claim is older than
-- the lease, so a worker that dies mid-dial does not wedge the attempt forever.
-- The accept/fail write is fenced on the token, so a superseded worker cannot
-- overwrite the row the new owner now controls.
ALTER TABLE call_attempts ADD COLUMN claim_token TEXT;
ALTER TABLE call_attempts ADD COLUMN claimed_at TEXT;

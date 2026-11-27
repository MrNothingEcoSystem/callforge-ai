-- TECH-016 (M05): provider-reported call outcomes per attempt.
-- Until now every allowed dial counted against the R10 retry ceiling as
-- `no_answer` because nothing consumed provider events for the attempt row.
-- `outcome` is nullable on purpose: absent means "not yet reported", and the
-- ceiling keeps its conservative reading. `outcome_at` is the provider's own
-- timestamp when supplied, so a later-arriving event is ordered correctly.
ALTER TABLE call_attempts ADD COLUMN outcome TEXT
  CHECK (outcome IN ('answered', 'no_answer', 'voicemail', 'callback', 'ended_unanswered', 'failed'));
ALTER TABLE call_attempts ADD COLUMN outcome_at TEXT;
ALTER TABLE call_attempts ADD COLUMN duration_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_call_attempts_provider_ref
  ON call_attempts(provider, provider_ref);

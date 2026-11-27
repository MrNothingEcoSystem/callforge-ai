# TECH-016 review — provider attempt outcomes

Reviewer: dispatcher cycle 227, read-only detached pass against `84cceee` (the pre-remediation
head), plus an out-of-band SQLite replay. Not a milestone acceptance; PR #203 stays draft.

## Verdict: ACCEPT WITH FOLLOW-UPS

## Probes

- **Upgrade path** (the thing a schema change can really break): built a database at `0001…0008`,
  inserted a tenant, intent, allowed dial request and accepted attempt, then applied `0009`.
  Existing row survived intact with `outcome` NULL, the CHECK rejected `hung_up`, NULL still
  accepted, and the correlation index exists.
- **Correlation scoping**: a same-`provider_ref` event from a different provider misses (test).
- **Monotonicity**: forcing `readAttempts()` back to the literal `no_answer` reds the ceiling test
  (1 failed / 8 passed); restore greens it.
- Duplicate event replay leaves the first `outcome_at` untouched.

## Findings

- **F1 (Low, fixed `a0e4590`)** — `reconcileProviderEvent` now parses a JSON-string `payload`. The
  in-memory callers pass objects, but the inbox stores `raw_body` as text, so a replay path handing
  the stored string back would have skipped outcome capture silently. Test added (224 total).
- **F2 (Low, note only)** — `readAttempts()`'s LEFT JOIN is single-row only because
  `UNIQUE(dial_request_id)` holds on `call_attempts`. If that uniqueness is ever relaxed for
  multi-leg dials, the join duplicates attempts and inflates the ceiling count.
- **F3 (Low, by design)** — a `failed` attempt has no `provider_ref`, so no handle to correlate an
  outcome back to. The row stays outcome-less and still counts as unanswered, which is the right
  conservative result for a call that never got a handle.
- **F4 (Info)** — `outcome_at` is stored as the provider's string unvalidated. It is informational
  only (nothing orders on it yet); a real carrier vocabulary (EXT-003) should also pin the format.

## Residual risk

The outcome vocabulary is ours, not a carrier's, and `voicemail`/`failed` are treated as answered
by `UNANSWERED_OUTCOMES` — both are EXT-002/EXT-003 readings. Nothing here places a live call.

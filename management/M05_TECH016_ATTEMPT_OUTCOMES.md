# TECH-016 — provider call outcomes on the attempt record

Status: draft, stacked on #202 (`tech-015-dial-sink`). No merge, no live call, no spend.

## Problem

`readAttempts()` has counted every allowed dial as `no_answer` since TECH-011. That is the
conservative reading of the R10 retry ceiling (1 unanswered/24h, 2/7d), and it was the only
possible one while nothing consumed provider events for the attempt row — but it is wrong the
moment the carrier says what happened. A call that connected still consumed the ceiling, so a
second legitimate dial in the day was blocked by a call the customer actually took.

TECH-015 gave the attempt row a provider handle (`provider_ref`). This increment is the read
side of that handle.

## What

- `db/migrations/0009_call_attempt_outcomes.sql` — nullable `outcome` (CHECK-constrained to the
  six known values), `outcome_at`, `duration_seconds`; index on `(provider, provider_ref)` for
  the correlation lookup. Nullable on purpose: absent means "not reported yet".
- `workflow/attemptOutcomes.mjs` — `recordAttemptOutcome(db, { provider, providerRef, outcome, … })`.
- `workflow/webhookInbox.mjs` — reconciliation notes an outcome when the event payload carries
  one. Outcome capture is independent of the intent transition, so a `call.completed` that is
  stale for the state machine is still authoritative for the attempt.
- `workflow/dialGate.mjs` — `readAttempts()` LEFT JOINs the attempt and reports
  `outcome ?? 'no_answer'`.

## Invariants

- **Fail-closed**: an unrecognised outcome string is `unknown_outcome` and the row is untouched;
  a provider inventing a status cannot widen the ceiling.
- **Correlated, never created**: the lookup is `(provider, provider_ref)`; a missing one is
  `unknown_attempt`, never an insert. Scoping by provider stops a same-ref event from another
  carrier applying.
- **First-wins**: a redelivered or out-of-order event cannot rewrite an outcome; it may only fill
  a missing duration. Delivery is at-least-once, so the ceiling stays monotonic.
- **Nothing assumed**: no outcome means `no_answer`, exactly as before. This module reports, the
  evaluator (`UNANSWERED_OUTCOMES`) decides what counts.

## Deliberate non-goals

- `voicemail` and `failed` are treated as answered (machine reached / retry allowed). Whether a
  voicemail should count against a marketing ceiling is an EXT-002 reading, not settled here.
- No provider-specific event schema: the mapping from a real carrier's vocabulary to these six
  words is EXT-003 work.
- Outcome-to-intent correlation (recording _why_ an intent ended) stays with `stateMachine`,
  review TECH-015 F4.

## Gates

`tests/m05-attempt-outcomes.test.mjs` — 9 tests: capture, ceiling effect in both directions, the
unreported default, unknown outcome, unknown attempt, missing correlation, first-wins with the
duration-only refinement, cross-provider miss, capture through a stale webhook, and the provider
timestamp surviving a duplicate. Mutation check: forcing `readAttempts()` back to a literal
`no_answer` reds the ceiling test (1 failed / 8 passed), restoring greens it.

Whole suite 223 collected, 0 assertion failures — 171 report `passed` and 52 land in the five
`better-sqlite3` 11.10 teardown-SIGABRT files (TECH-009, fixed on #193, not in this stack).
tsc 0, eslint 0, prettier clean.

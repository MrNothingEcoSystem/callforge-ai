# TECH-015 review record — `call.dial` sink (PR #202)

Reviewer: dispatcher cycle 225, read-only against head `81a6953` apart from the two in-cycle fixes below.
Scope: `telephony/*`, `db/migrations/0008_call_attempts.sql`, the `dispatcher.mjs` registry line, tests.

## Verdict: ACCEPT WITH FOLLOW-UPS

The gap it closes is real (an allowed dial was acked as a noop) and the implementation keeps the
properties the outbox relies on: the attempt row precedes the provider call, `UNIQUE(dial_request_id)`
plus the `already_accepted` short-circuit block a second call on redelivery, and only a thrown error
returns the row for backoff.

## Fixed in-cycle

- **F1 (real, medium)** — the sink never checked `dial_requests.status`, so a row that somehow carried
  a `call.dial` while the decision was `denied`/`pending` would have dialed. Now no-ops unless
  `allowed`; test asserts no attempt row and no provider call. Confirmed red before the fix.
- **F2 (low)** — `resolveProvider()` ran before the attempt insert, so an unconfigured provider could
  leave a `dispatching` row with no adapter. Verified by reading: resolution is now the first statement,
  before any write, and a test covers the unknown-name throw.

## Follow-ups (non-blocking)

- **F3 (CLOSED cycle 228, `70d6219`, PR #204)** — average-case concurrency: two dispatcher workers can both pass the `prior` check; the
  second insert fails on the UNIQUE and retries, but if the first is still mid-flight the carrier sees
  two dials. The `idempotencyKey` contract is the only defence. Revisit with a claimed-status CAS when
  a second worker is actually run.
- **F4** — `call_attempts` has no retention policy and is not joined to `provider_events`; outcome
  correlation (and therefore `readAttempts()` counting a real outcome rather than assuming
  `no_answer`) waits on webhook→intent mapping.
- **F5 (CLOSED cycle 229, `616379d`, PR #205)** — the sink trusts `payload.dialRequestId` without cross-checking `row.aggregate_id` against
  `request.call_intent_id`. Cheap to add; no reachable divergence today since the payload is minted in
  the same transaction as the request.
- **F6** — `simulatedProvider` keeps `calls` as module-level state, so a long-lived process grows it
  unbounded. Test-only convenience today.

Now claimed by a CAS + 300s lease + `claim_token` fence; loser no-ops as `already_dispatching`.
See `management/TECH015_F3_REVIEW_RECORD.md` (verdict ACCEPT, two-process probe).

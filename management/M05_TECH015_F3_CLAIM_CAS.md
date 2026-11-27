# TECH-015 F3 — dial-sink claim CAS (M05)

Follow-up F3 from `management/TECH015_REVIEW_RECORD.md`: two dispatcher workers could both pass
the `prior` check and both reach the carrier, with only the provider `idempotencyKey` (and the
`UNIQUE(dial_request_id)` retry path) standing between one intent and two dials.

## Change

- `db/migrations/0010_call_attempt_claim.sql` adds `claim_token` and `claimed_at`. Additive only;
  the ceiling query and the outcome join are untouched.
- `telephony/dialSink.mjs` replaces the read-then-write claim with a compare-and-set inside an
  `IMMEDIATE` transaction: a `failed` row is retry-claimable, an `accepted` row no-ops, and a
  `dispatching` row is claimable only once its `claimed_at` is older than `CLAIM_LEASE_SECONDS`
  (300s). A live claim by another worker returns `already_dispatching`.
- Every terminal write (accepted / failed / handle-less failure) is fenced on `claim_token`. A
  worker whose lease expired mid-dial cannot overwrite the row its replacement now owns; it
  returns `superseded: true` and does not move the intent, so the same intent is not transitioned
  twice. The claim token is cleared on both terminal writes.

## Reasoning on the residual overlap

A lease is not a lock: a worker that is merely slow (not dead) can still overlap a replacement
after the lease expires, so two carrier dials remain possible in that window. That is deliberate —
without a lease a crashed worker wedges the attempt at `dispatching` forever, which is worse than a
duplicate the carrier can dedupe on `idempotencyKey`. The short path (both workers alive, one
claim) is now serialised.

## Tests

3 added on `tests/m05-dial-sink.test.mjs` (parked provider proves the second worker never reaches
the carrier; lease-expired reclaim; live claim held). 227/227 whole suite, tsc/eslint/prettier clean.
Migration is additive and upgrade-safe: existing rows get NULL claim columns.

Not covered: multi-process proof on a real second worker (the CAS is exercised in-process only);
carrier-side dedupe on `idempotencyKey` remains EXT-003.

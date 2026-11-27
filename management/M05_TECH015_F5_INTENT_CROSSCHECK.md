# TECH-015 F5 — outbox/intent cross-check at the dial sink

Review finding (management/TECH015_REVIEW_RECORD.md, F5): `handleCallDial` trusted
`payload.dialRequestId` and dialled whatever request that id resolved to, without checking that
the request's `call_intent_id` matched the outbox row's `aggregate_id`. The producer mints both in
one transaction, so no divergence is reachable today — but the sink is the place where DIALLING
DECISIONS become carrier calls, so a silent mismatch would file attempt evidence, and later
outcomes, under the wrong intent.

## Change

After loading the `dial_requests` row and before the status check:

- `row.aggregate_id` must equal `request.call_intent_id` when present;
- `payload.callIntentId`, when present, must equal the same value.

Either divergence returns `{ noop: true, reason: 'intent_mismatch' }` — fail-closed, no attempt
row, no provider call, nothing enqueued. Absent values are tolerated so an older producer payload
(no `callIntentId`) still dials; `aggregate_id` is `NOT NULL` in `0002` so only a caller-supplied
partial row can omit it.

## Non-goals

- No re-resolution of the request (the gate decision is snapshotted and stands).
- No terminal `failed` state: a mismatch is a data defect, not a transient error, so it should not
  burn the dispatcher's retry budget.
- Does not verify `tenant_id` agreement between row and request; tenant is already bound to the
  request by the gate and the row's tenant is set from the same request.

## Tests

Three in `tests/m05-dial-sink.test.mjs`: tampered `aggregate_id`, tampered `payload.callIntentId`,
and the legacy payload with no intent copy (still dials). Removing the aggregate comparison reds
the first (mutation-checked). Suite 230/230.

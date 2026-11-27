# TECH-011 — dial gate wired into the M03 dispatch path

Cycle 219, 2026-11-27. Branch `tech-011-dial-gate-wiring`, draft PR (stacked on #197).
Base is `m04-compliance-dial-gates` (PR #197), not `main`: the wiring imports
`policies/dialEligibility.mjs`, which only exists there. Retarget to `main` after #197.

## What this is

Until now the M04 policy core was a pure function nobody had to call. This increment
makes skipping it the hard path: producers call `requestDial()`, which snapshots the
campaign/contact/policy facts into `dial_requests` (migration `0005`) and enqueues
`dial.requested` in the same transaction. The outbox dispatcher owns a `dial.requested`
handler that evaluates the snapshot and either enqueues one `call.dial` row or records
the denial. A denial is a decision, so it is acked, not retried; only a thrown error
enters the `fail()` backoff.

Facts are snapshotted rather than re-read so the verdict is reproducible after a lease
gap, and so a later edit cannot silently change a queued decision.

## Behaviour pinned by tests

| Case                                            | Result                                      |
| ----------------------------------------------- | ------------------------------------------- |
| all inputs valid, inside window                 | `allowed`, exactly one `call.dial`          |
| missing consent / listed DNCR / expired licence | `denied`, reasons with rule id, no dial row |
| outside 09:00–18:00 Asia/Dubai                  | `denied` (`r08_outside_window`)             |
| prior allowed dials hit the ceiling             | `denied` (`r10_retry_day`)                  |
| redelivery or unknown request                   | no-op, no duplicate dial                    |
| allow and deny through `dispatchOnce()`         | both acked, `failed === 0`                  |

`readAttempts()` is bounded above by `now`, so a future-dated request cannot hide
today's counts — the R10 half of PR #197 review follow-up F2. Until M05 reports real
outcomes, every allowed dial counts as unanswered (the conservative reading).

## Explicitly still open

- No real sink behind `call.dial` — M05. The next handler will be the dialer bridge.
- DNCR/consent facts are whatever the caller passes (**TECH-012**); with none, the gate
  denies. No portal/API integration yet.
- Licence/CLI inventory is passed per request, not stored per tenant (PR #197 F4).
- Not legal advice; EXT-002 still owns the thresholds.

## Gate result

`vitest run --pool=threads` **162/162**, eslint 0, tsc 0, prettier clean. `policies/**`
was added to `tsconfig.json` include (the tree had no included importer before, so its
JSDoc type errors were invisible). Mutation check: replacing the attempts array with
`[]` reds only the ceiling test; restored, green.

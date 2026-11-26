# PR #189 — Independent Review Record (cleanup: issues #2/#4/#5/#6)

Reviewer: CALLFORGE OMEGA dispatcher (self-review; `delegate_task` unavailable in cron
runtime, as recorded in cycle 1). Date: 2026-11-26. Base: `origin/main` 28c9040.
Reviewed head: 564b014, re-reviewed after remediation: see PR head at merge-request time.

## Scope checked

- `audit.mjs` verifyChain mid-chain seeding (#2) and `getEvents` rowid ordering (#4).
- `tests/auth.test.mjs`, `tests/store.test.mjs` node:crypto imports (#5).
- `tests/esm-runtime.test.mjs` real listen/close smoke (#6).
- Full suite, lint, prettier, tsc against the branch.

## Verdict: ACCEPT WITH FOLLOW-UPS

Core change is correct: a segment verified from `fromEventId` now anchors on the true
predecessor hash instead of the genesis sentinel, and a tampered predecessor propagates
into the segment verdict (verified by probe, not just the new test). Ordering by `rowid`
removes the identical-timestamp nondeterminism. `#5` and `#6` are test-hygiene fixes
with no production surface.

## Findings

| ID  | Severity                                | Finding                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                                                                      |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Low (pre-existing, not introduced here) | Full-chain `verifyChain()` reports "Hash chain broken" once the oldest row is removed, because the first surviving event's `previous_hash` no longer matches the genesis seed. `audit_events` is currently EXCLUDED from retention (`workflow/quota.mjs` RETENTION_PROTECTED), so no production impact yet; it blocks any future audit archival/checkpoint policy. | **Fixed on this branch** — truncated head is now reported as `anchored:false` + warning instead of a chain break; middle-row deletion and forged genesis sentinels still fail. Signed checkpoints remain the owner's archival-policy choice |
| R2  | Low                                     | `verifyChain(unknownId)` returned `valid: true` with 0 events checked — a caller passing a stale id got a false "chain OK".                                                                                                                                                                                                                                        | **Fixed** — returns `valid:false`, `Unknown start event`; regression test added                                                                                                                                                             |
| R3  | Nit                                     | Unused `e1` binding in the new #2 test tripped an eslint warning.                                                                                                                                                                                                                                                                                                  | **Fixed**                                                                                                                                                                                                                                   |
| R4  | Nit                                     | #6 test picked a random port in a fixed 31000–33000 range; collisions flake CI.                                                                                                                                                                                                                                                                                    | **Fixed** — ephemeral port reserved via `net` probe                                                                                                                                                                                         |
| R5  | Info (API contract)                     | `getEvents` is now newest-first by `rowid`; consumers that paginated assuming ascending `created_at` must be re-checked. Only `tools/index.mjs` `access_audit_log` consumes it, and it exposes `limit`/`offset` passthrough.                                                                                                                                       | Documented                                                                                                                                                                                                                                  |

## Evidence

- Pre-remediation head 564b014: 111/111 vitest pass, CI verify SUCCESS (run 44983783150).
- Probe (Node 24.11.0, temp DB): tampering the predecessor of a mid-chain segment yields
  `valid:false`; deleting the genesis row yields a break at the new head.
- Post-remediation: 112/112 vitest pass, eslint 0 errors 0 warnings, prettier check clean,
  `tsc -p tsconfig.json` clean.
- Toolchain note: the cached Node 24 at `/root/.hermes/cache/scratch/node24` had been pruned
  by scratch retention; re-provisioned v24.11.0. Node 26.12.1 cannot build better-sqlite3
  11.10 (V8 `GetPrototype`/`GetIsolate` removals).

## Merge posture

Draft, unmerged. No deploy, no live calls, no spend. Issues #2/#4/#5/#6 close on merge,
which remains an owner decision.

## Addendum — R1 remediation (issue #190)

R1 was filed as issue #190 and fixed on this branch rather than deferred, because both
options in the issue reduce to how `verifyChain()` seeds its first checked event.

Implemented (issue option 1, explicit rather than silent): verification now computes
`anchored` from whether the oldest stored event still carries the genesis sentinel. A
truncated head seeds from the first available event's own `previous_hash`, returns
`valid:true` with `anchored:false` and a `warnings[]` entry, so callers see that the range
is unanchored instead of a false integrity failure. Middle-row deletion still yields
`Hash chain broken`, and the genesis skip was tightened to the first checked event so a
mid-chain event that forges the sentinel is now rejected (previously it escaped the link
check). Issue option 2 (signed checkpoint per archive batch) remains the durable answer and
stays with the owner's archival policy.

Tests: 4 added (intact chain stays `anchored:true`; truncated head valid+unanchored, both
full-range and from the surviving head; deleted middle row still broken; forged sentinel
detected). Suite 116/116, eslint clean, prettier clean, tsc clean.

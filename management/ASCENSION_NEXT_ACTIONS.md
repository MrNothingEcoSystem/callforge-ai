# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-19T11:05Z (cycle 66)

## Cycle 66 (2026-11-19, dispatcher)

- M02/M03-1/M03-2 are MERGED to main (PRs #7, #9, #20; main 28c9040). Ledger milestone statuses below still predate those merges; reconciling them is its own bounded task (see Cycle 66 log).
- SEC-001 fix: draft PR #65 (m02-oauth-tenant-isolation) — CI verify was FAILING on prettier indentation in server.mjs; fixed in ef9f1ac (73/73 tests, lint clean), CI now PASS (run 44511203763). PR remains DRAFT awaiting owner review/merge. Awaiting independent review verdict — delegate_task unavailable in cron env; request via owner.
- Issues #2/#4/#5/#6: draft PR #67 (cleanup-issues-2-4-5-6, 112/112) awaiting owner review/merge. Issue #8 (MCP surface) still open; PR #51 also covers #2/#4/#5/#6 (duplicate) — owner to pick one.
- Open draft PRs #47-#64 are accumulated cycle docs awaiting owner merge decision; #66 (Chapter 06) awaiting EXT-010.

## Highest priority

## Highest priority (supervisor-verified 2026-11-09T04:30Z)

M02 PR #7: independent audit ACCEPT WITH FOLLOW-UPS; SEC-002 + part of SEC-003 fixed in 65ff410 (73/73, CI PASS). Remaining before M02 can be accepted as production identity:

1. SEC-001: replace unauthenticated /oauth/authorize self-assertion with a real IdP / authenticated user step. Until then M02 is a simulation baseline and must not be network-exposed.
2. Non-blocking: scope re-derivation from role at token validation; conversation fixture scoping decision (currently documented global).
3. Owner merge decision on PR #7 (draft, unmerged).

## Next engineering

- M03-1 done on PR #9 (dec034e): migrations, outbox, state machine, webhook inbox, backup/restore. Next: independent review of PR #9, then M03-2 (dispatcher loop, quota counters).
- Issues #2, #4, #5, #6 (audit verifyChain, rowid ordering, node:crypto in tests, listen/close smoke) — bundle into one cleanup PR. Issue #8 (MCP surface) before M09.
- M04 research track (parallel): UAE requirements register with source/jurisdiction/effective-date/legal-review status.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

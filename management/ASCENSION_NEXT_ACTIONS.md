# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-09T04:25Z (cycle 1)

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

## Cycle 82 update (2026-11-19)

- F-71-2 root cause fixed at 11efab3 on tech006-vitest-flake (PR #71): better-sqlite3 11.10.0 -> 12.11.1; 20/20 threads + 10/10 forks runs pass (108/108 each). F-71-1 + F-71-2 addressed; next: independent re-review of PR #71, then owner merge.
- Remaining follow-ups (unblocked): F-70-1/F-70-2 (compliance gate counters/whitespace), F-67-1/F-67-2. Everything else owner-gated (merges, F-65-4 bootstrap, EXT-001..EXT-009).
- Draft PRs awaiting owner merge: #65, #66, #67, #70, #71, #76, #77, #78, #79, #80, #81.

## Cycle 83 update (2026-11-19)

- F-70-1/F-70-2 fixed at 124b087 on m04-compliance-gate (PR #70): counters >=0, trim on opener/consentRef; 122/122 tests, lint/format/typecheck PASS. Next: independent re-review of PR #70, then owner merge.
- Still pending re-review: PR #71 at 11efab3 (F-71-2 root-cause fix).
- Remaining follow-ups (unblocked): F-67-1/F-67-2. Everything else owner-gated (merges #65/#66/#67/#70/#71/#76-#82, F-65-4 bootstrap, EXT-001..EXT-009).

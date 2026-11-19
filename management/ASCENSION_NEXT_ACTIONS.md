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

## Cycle 76 update (2026-11-19)

- PR #66 (chapter-06) CI fixed and green (6f89447, run 44566903910); self-review ACCEPT, merge owner-gated (EXT-010).
- Draft PRs now all green and awaiting owner merge direction: #65 (SEC-001 rework, ACCEPT WITH FOLLOW-UPS, F-65-4 bootstrap open), #66 (chapter-06), #67 (cleanup #2/#4/#5/#6), #70 (M04 compliance gate inc. 1), #71 (TECH-006 threads pool).
- Highest-priority unblocked work exhausted until owner decisions: next actions are owner merges + F-65-4 bootstrap decision (dev-token issuer vs real IdP). Engineering continues on independent work only when a new unblocked task emerges.
- TECH-006: 108/108 verified with threads pool; default forks pool SIGABRT flake until PR #71 merges.

## Cycle 79 update (2026-11-19)

- PR #67 (cleanup #2/#4/#5/#6, 1fea545) independent review: ACCEPT WITH FOLLOW-UPS (112/112 threads pool, CI green). F-67-1 low (verifyChain unknown id vacuously valid, pre-existing), F-67-2 nit (unused e1 warning). TECH-002 resolvable on owner merge.
- Last unreviewed engineering PR: #71 (TECH-006 threads pool) — next dispatcher cycle should review it.
- Draft PRs green and awaiting owner merge: #65, #66, #67, #70, #71, #76, #77, #78. F-65-4 bootstrap decision still owner-gated. EXT-001..EXT-009 unchanged.

## Cycle 78 update (2026-11-19)

- PR #70 (M04 compliance gate, 97d6e7b) independent review: ACCEPT WITH FOLLOW-UPS (120/120, CI green). F-70-1 negative counters, F-70-2 whitespace strings, F-70-3 optional gate_input bypass, F-70-4 R04 scope gap. See ASCENSION_BLOCKERS.md cycle 78.
- Unreviewed engineering PRs remaining: #67 (cleanup #2/#4/#5/#6), #71 (TECH-006 threads pool) — next dispatcher cycles should review one each.
- Draft PRs green and awaiting owner merge: #65, #66, #67, #70, #71, #76, #77. F-65-4 bootstrap decision still owner-gated. EXT-001..EXT-009 unchanged.

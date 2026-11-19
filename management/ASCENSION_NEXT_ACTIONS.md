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

## Cycle 88 update (2026-11-19)

- Independent review of PR #66 at 6f89447 (chapter-06-expansion): **ACCEPT WITH FOLLOW-UPS** (research-only; chapter 6,627 words, 37-row claim matrix; CI SUCCESS run 44566903910; local TECH-006 flake from pre-PR #71 base). Follow-ups: F-66-1 truncated OWASP filenames in 6 matrix rows; F-66-2 CLEAN/chapter duplicate canonical decision; rebase before merge. Next: owner merge decisions on draft PRs #61/#64/#65/#66/#67/#70/#71/#76-#87; EXT-001..EXT-010 unchanged.

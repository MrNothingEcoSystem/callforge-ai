# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-10T02:45Z (cycle 35)

## Highest priority (supervisor-verified 2026-11-09T04:30Z)

M02 PR #7: independent audit ACCEPT WITH FOLLOW-UPS; SEC-002 + part of SEC-003 fixed in 65ff410 (73/73, CI PASS). Remaining before M02 can be accepted as production identity:

1. SEC-001: replace unauthenticated /oauth/authorize self-assertion with a real IdP / authenticated user step. Until then M02 is a simulation baseline and must not be network-exposed.
2. Non-blocking: scope re-derivation from role at token validation; conversation fixture scoping decision (currently documented global).
3. Owner merge decision on PR #7 (draft, unmerged).

## Next engineering

- M03-1 done on PR #9 (dec034e): migrations, outbox, state machine, webhook inbox, backup/restore. Next: independent review of PR #9, then M03-2 (dispatcher loop, quota counters).
- Issues #2, #4, #5, #6 (audit verifyChain, rowid ordering, node:crypto in tests, listen/close smoke) — bundle into one cleanup PR. Issue #8 (MCP surface) before M09.
- M04 research track (parallel): UAE requirements register — source re-verification pass completed this cycle (docs/ascension-cycle-035 → draft PR; verification section added to register). M04 remains pending closure: blocked by M02 SEC-001 (owner IdP decision), M03 closure (PR #22 awaits owner merge), EXT-002 qualified UAE legal review. No unblocked engineering work remains this cycle; PR #22 (M03-2a quota wiring), PR #26 (issue #8 MCP surface), PR #51 (TECH-002 cleanup/issues #2/#4/#5/#6) await owner merge decisions. No completion percentages claimed.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

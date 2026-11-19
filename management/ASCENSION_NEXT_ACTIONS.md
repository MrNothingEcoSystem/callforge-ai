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

## Cycle 86 update (2026-11-19)

- Independent re-review of PR #70 at 124b087 (m04-compliance-gate): **ACCEPT** (simulation baseline). F-70-1/F-70-2 verified fixed in source + 122/122 tests + lint/format/typecheck + CI PASS; adversarial probes (negative/float/NaN/string counters, whitespace fields, suppressed formats, calling-hours boundary) all fail closed. F-70-3 (optional gate_input) and F-70-4 (R04/R17/R18 scope) remain documented pre-live requirements. Verdict: PR #70 issuecomment-7023277760. Next: independent re-review of PR #71 at 11efab3; owner merge decisions on draft PRs #65/#66/#67/#70/#71/#76-#85; EXT-001..EXT-009 unchanged.

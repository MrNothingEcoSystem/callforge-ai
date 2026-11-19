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

## Cycle 85 update (2026-11-19)

- Independent re-review of PR #67 at 98c31c4 (cleanup-issues-2-4-5-6): **ACCEPT**. Read-only audit in isolated worktree (delegate_task unavailable in cron env, performed directly). F-67-1 guard (`fromEventId && events.length === 0` → valid:false, 'Anchor event not found') verified in source; no-arg path unaffected (guard gated on truthy fromEventId; tools.test.mjs green). Regression test at tests/audit.test.mjs:229-237. Gates locally: 113/113 tests pass (13 files), lint 0 errors/0 warnings, format:check PASS, typecheck PASS; one transient SIGABRT worker flake on first run (TECH-006, cf. PR #71) — rerun green, exit 0. GitHub CI verify PASS on PR #67 head 98c31c4. Verdict recorded as PR #67 review comment. Next: independent re-review of PR #70 at 124b087, then PR #71 at 11efab3; owner merge decisions on draft PRs #65/#66/#67/#70/#71/#76-#84; EXT-001..EXT-009 unchanged.

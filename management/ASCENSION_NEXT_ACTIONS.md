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

## Cycle 214 — TECH-005 proven (PR #194)

Two-cycle process-death test (`tests/m032-crash-recovery.test.mjs` + fixture) on a new
`main`-based branch: live lease respected, expired lease reclaimed, keyed effect exactly
once, crashed webhook `processed` exactly once, nothing stranded; mutation-checked against a
neutered reclaim predicate. Tests only, 1/1 (5 runs across two worktrees), full suite
256/256 exit 0 with #193 merged, CI SUCCESS. Review record
`management/TECH005_REVIEW_RECORD.md`, verdict ACCEPT, I1–I3 Info.

Merge order for the owner is now **#193 → #194** (both independent: dep-only and
tests-only, rebasable) **→ #189 → #191 → #192**. Nothing defect-class is left locally on
`main`; open work is Info polish, the SEC-001 IdP sign-off (then §7B/§7G/EXT-008), and
TECH-004's Postgres-vs-SQLite design decision.

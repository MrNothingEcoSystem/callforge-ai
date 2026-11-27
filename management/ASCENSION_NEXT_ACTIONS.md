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

## Cycle 215 — TECH-004 decision record (PR open)

`management/TECH004_DB_DECISION.md` — M03's last open design deliverable, docs-only.
TECH-004 is now a conditional decision (D-008) awaiting independent review: keep SQLite
through M06/M09, port at the first availability/archival trigger, no facade-first. Measured
coupling on `main` @ `28c9040`: 87 `prepare()` sites, 6 sync `db.transaction`, 45
`datetime('now')`, 2 `INSERT OR IGNORE`, 4 correctness-bearing `rowid` reads, no `STRICT`
tables, all single-column PKs random UUIDv4 — so the hash chain has no portable ordering key
today. Cheapest engine-neutral hedge, to land before any port: a monotonic `seq` column on
`audit_events` ordered instead of `rowid`, plus #190 option 2 (signed checkpoint).

Still owner-gated: #193 → #194 → #189 → #191 → #192 merge order, SEC-001 IdP sign-off.

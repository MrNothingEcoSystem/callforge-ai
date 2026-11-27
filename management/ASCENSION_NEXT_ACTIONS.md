# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-27T09:5xZ (cycle 218)

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

## Cycle 216 — TECH-004 hedge landed on branch

`tech-004-audit-seq-hedge` (base #189) adds migration 0004: `seq` on `audit_events`,
backfilled in rowid order, unique index, AFTER INSERT trigger allocating `MAX(seq)+1`;
`audit.mjs` head/verifyChain/getEvents now order by `seq`. Proof: seq is gap-free and
monotonic, and reads follow `seq` when `rowid` is left untouched (test). This is the
cheap engine-neutral hedge D-008 requires before any Postgres port; #190 option 2
(signed checkpoint) is still the owner-side archival-policy half.

Open owner decisions unchanged: merge order #193 → #194 → #189 → hedge → #191 → #192,
then #195 (decision record). SEC-001 IdP sign-off still blocks M02 production identity.

## Cycle 217 — PR #196 independent review

Verdict ACCEPT WITH FOLLOW-UPS on `management/PR196_REVIEW_RECORD.md`. Review F1 was real:
`workflow/stateMachine.mjs` was the one reader left on `rowid`; fixed and covered by a test
that forces `seq`/`rowid` to disagree. Remaining follow-ups are F3 (nullable `seq`, needs a
table rebuild), F4 (single-writer collision is fail-loud, revisit at port), F5 (`ROW_NUMBER()`
backfill if the table grows). Nothing here is merge-blocking; the owner merge chain is now
#193 → #194 → #189 → #196 → #191 → #192, then #195. Local gates need `--pool=threads` until
#193 lands (TECH-009 fork-teardown SIGABRT).

## Cycle 218 — review follow-ups F3/F5 closed on #196

`53c4990` adds `db/migrations/0005_audit_seq_notnull.sql`: 12-step rebuild of `audit_events`
with `seq INTEGER NOT NULL`, dense `ROW_NUMBER()` backfill, and allocation moved into the
INSERT at both call sites (an AFTER trigger can never satisfy NOT NULL). 120/120, CI verify
PASS (run 45976522060). `CHECK (seq > 0)` was tried and dropped — the seq-inversion tests need
an out-of-band sentinel.

Still open and unblocked: nothing in the defect class. Remaining #196 items are documented-only
(F4 fail-loud single-writer collision — revisit with the port; F6 test restores `seq` in place).
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192, then #195.

Next cycle should not start new code without owner input if CI stays green: the queue is six
draft PRs and the SEC-001 IdP decision. Cheapest remaining unblocked item is the #189/#196
retarget dry-run notes (base switch after #189 merges) or a TECH-005 dispatcher recovery check
over two cycles.

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

## Cycle 218 — M04 increment 1 landed (PR #197)

Every queued engineering item was a draft PR awaiting owner merge and SEC-001 is
IdP-gated, so the cycle took the one unblocked track the roadmap still has: M04's
"fail-closed policy" half. `policies/dialEligibility.mjs` evaluates gates G1–G5 as a
pure function — deny on missing licence/approval, unbound CLI, absent or mismatched
consent purpose, DNCR unknown/stale/listed, outside 09:00–18:00 Asia/Dubai, opted out,
or over the 1-callback/day, 2-callback/week ceiling. 43 tests, 151/151 suite, CI
SUCCESS on `5cb930c`.

Review F1 fixed in-cycle; F2–F4 recorded. Next on this track: TECH-011 wiring at the M03
dispatch path, then TECH-012 DNCR/consent sources. M04 closure still needs EXT-002.

Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195. #197 is
independent of that chain and can be reviewed or parked without touching it.

## Cycle 219 — TECH-011 dial gate wired (stacked PR)

`requestDial()` now snapshots the decision inputs into `dial_requests` and the outbox
dispatcher owns a `dial.requested` handler, so the M04 evaluator is on the M03 path
instead of being an optional call. Allow enqueues one `call.dial`; deny is recorded and
acked (a decision, not a failure). 162/162, tsc/eslint/prettier clean. Needs independent
review; retarget to `main` after #197. Remaining on this track: TECH-012 (DNCR/consent
sources), the M05 `call.dial` sink, and F4 (tenant policy records). Owner merge chain
unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then #197 → this branch.

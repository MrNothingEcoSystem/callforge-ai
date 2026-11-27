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

## Cycle 220 — TECH-012 fact sources (stacked PR)

`requestDialResolved` now reads consent, opt-outs and a 24h-TTL DNCR answer from durable
sources (`consents`, `opt_outs`, `dncr_checks`, migration 0006) instead of trusting the
caller's snapshot; unknown/outage denies and is recorded. 177/177, tsc/eslint/prettier
clean, mutation-verified; **reviewed in-cycle, ACCEPT WITH FOLLOW-UPS, F1/F2 fixed** (draft PR
#199, CI SUCCESS at `c356d5e`). Stacks on #198 → #197.

Remaining on the M04 track: a real DNCR provider/portal (EXT-003), a "re-query now"
dashboard action (#198 F4), and tenant policy records (#197 F4). Then EXT-002 for closure.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → this branch.

## Cycle 221 — TECH-013 tenant policy record (stacked PR)

Review F4 on #197 is closed: `tenant_policies` (migration 0007) replaces the hard-coded
window/ceilings/DNCR ceiling with a per-tenant record; absent row = statutory defaults, a
corrupted row denies (`invalid_policy`) rather than widening the gate, and the values are
snapshotted into the request so the decision is reproducible. 186/186, tsc/eslint/prettier
clean, draft PR #200 (stacks on #199 → #198 → #197). Remaining on the M04 track: writing a
policy (dashboard), half-hour windows, folding the record into the legacy `requestDial`
producer, a real DNCR provider (EXT-003), then EXT-002 for closure.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → this branch.

## Cycle 222 — independent review of TECH-013 (PR #200)

Verdict ACCEPT WITH FOLLOW-UPS on `management/TECH013_REVIEW_RECORD.md`. Review F5 was real:
a stored row that fails validation reached the evaluator as `options: null`, which was treated
as "absent" and substituted the statutory defaults, so a corrupt 18–9 window still dialled at
10:00 instead of denying. Fixed by distinguishing `undefined` (no record → defaults) from
`null` (record present but unusable → `invalid_policy`, detail from the snapshotted
violations); two tests added, both red on the pre-fix evaluator. Gates 188/188, tsc/eslint/
prettier clean.

Open from the review, none blocking: F1 legacy `requestDial` producer still default-only,
F2 whole-hour windows (Res.57 half-hours need EXT-002), F3 no write surface/dashboard,
F6 `dialEligibility` ⇄ `tenantPolicy` import cycle, F7 shallow-frozen defaults.

Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200. M04 closure still needs EXT-002.

## Cycle 223 — review F1 closed (legacy producer)

`requestDial` now reads the tenant policy record itself when no snapshot is supplied and
carries an unusable row through so dispatch denies `invalid_policy`; 3 tests, 2 red pre-fix,
191/191, CI PASS (run 45962081786). Remaining on the M04 track, all non-blocking: F3 write
surface (dashboard/API), F2 half-hour windows (EXT-002), F6 import cycle, F7 shallow-frozen
defaults, a real DNCR provider (EXT-003), then EXT-002 for territory/penalty sign-off.
Next engineering: the dashboard/API write surface for tenant policy (F3) — the only M04 item
that is neither an owner decision nor external — then the M05 `call.dial` sink.

## Cycle 224 — TECH-014 tenant policy write surface

`GET`/`PUT /tenant/policy` (PR #201, stacked on #200): tenant from the token only, `read` scope
for the read, `admin` for the write, validation before upsert (400 + violations, stored row
untouched), 409 on read when the stored row is unusable rather than silently serving defaults,
and the accepted policy is audited as `tenant_policy_updated`. 10 tests, 201/201 whole suite,
tsc/eslint/prettier clean, CI PASS (run 45966569644) at `13cb810`.
Review F3 is closed. Remaining on the M04 track, all non-blocking: F2 half-hour windows
(EXT-002), F6 import cycle, F7 shallow-frozen defaults, list/delete routes, last-write-wins on
concurrent PUTs, a real DNCR provider (EXT-003), then EXT-002 for the territory/penalty sign-off
and the human approval step itself.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → this. M04 closure still needs EXT-002.
Next engineering: the M05 `call.dial` sink (TECH-011 left it as the missing consumer), then the
F6 import split.

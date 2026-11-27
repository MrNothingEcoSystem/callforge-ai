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

## Cycle 225 — TECH-015 `call.dial` sink

The M05 sink #201's handoff named is landed on PR #202 (stacked on #201). `call.dial` had no handler,
so the gate's allow was acked as a noop: an authorised dial went nowhere. Now a provider-neutral port,
fail-closed resolution, an inert network-free simulated default, `call_attempts` evidence written
before the provider call, `UNIQUE(dial_request_id)` + `already_accepted` short-circuit for redelivery,
and an allow-only guard (review F1, fixed in-cycle). 10 tests, 211/211, tsc/eslint/prettier clean,
CI PASS at `81a6953`.
Review verdict ACCEPT WITH FOLLOW-UPS: F3 (concurrency CAS), F4 (retention + outcome correlation
once webhooks map to intents), F5 (aggregate cross-check), F6 (unbounded simulated call log).
Remaining on the M04/M05 track, all non-blocking: F2 half-hour windows and the territory/penalty
sign-off (EXT-002), F6 dialEligibility⇄tenantPolicy import cycle, F7 shallow-frozen defaults,
list/delete policy routes, a real DNCR provider (EXT-003). Nothing here places a live call.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → #201 → this. M04 closure still needs EXT-002.
Next engineering: the F6 import cycle split (small, purely internal), then webhook→intent outcome
mapping so `readAttempts()` stops assuming `no_answer`.

## Cycle 226 — TECH-013 F6/F7 closed (import cycle, default mutation)

`ccc7a4b` moves the statutory defaults into a neutral `policies/policyDefaults.mjs`, so
`dialEligibility` and `tenantPolicy` no longer import each other (one-way edge kept for
`validatePolicyOptions`), freezes the defaults all the way down and copies them per read.
214/214, tsc/eslint/prettier clean, CI PASS (run 45987017732). Review record
`management/TECH013_F6F7_REVIEW_RECORD.md`, verdict ACCEPT (probe: both modules load at top
level, re-export is the same frozen object, no behaviour diff).
Remaining on the M04/M05 track, all non-blocking: webhook→intent outcome mapping so
`readAttempts()` stops assuming `no_answer`; F2 half-hour windows and territory/penalty
sign-off (EXT-002); list/delete policy routes; last-write-wins on concurrent PUTs; a real DNCR
provider (EXT-003).
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → #201 → this. M04 closure still needs EXT-002.

## Cycle 227 — TECH-016 provider outcomes on attempts

`readAttempts()` no longer assumes `no_answer` for every allowed dial (which let a connected call
still consume the R10 ceiling). PR #202's F4 outcome correlation is answered by a `(provider,
provider_ref)`-correlated webhook write, first-wins, fail-closed on unknown strings, nullable so
the unreported default is unchanged. Draft PR #203 on branch `tech-016-attempt-outcomes`, stacked
on #202. Doc `management/M05_TECH016_ATTEMPT_OUTCOMES.md`.

Remaining M04/M05 items are now EXT-gated or cosmetic: F2 half-hour windows and territory/penalty
sign-off (EXT-002), a real DNCR provider (EXT-003), a carrier event vocabulary (EXT-003),
list/delete policy routes, last-write-wins on concurrent PUTs, TECH-015 F3 concurrency CAS,
F5 aggregate cross-check, F6 bounded simulated call log.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → #201 → #202 → this.

## Cycle 228 — TECH-015 F3 claim CAS

`70d6219` on `tech-015-f3-claim-cas`, draft PR #204, stacked on #203. Two dispatcher workers could
both pass the old `prior` check and dial; the claim is now a CAS on `status`/`claimed_at` inside an
IMMEDIATE transaction, holding a 300s lease and fenced by `claim_token`, so the loser no-ops as
`already_dispatching` and a superseded worker cannot overwrite the row or double-transition the
intent. Additive migration `0010`. 3 tests, 227/227, tsc/eslint/prettier clean. Review **ACCEPT**
including a real two-process race probe (`management/TECH015_F3_REVIEW_RECORD.md`).
F3-a remains: a worker slow past the lease can still overlap — carrier `idempotencyKey` is the
last defence and is EXT-003's to honour.

Remaining M04/M05 engineering, all non-blocking: F5 aggregate cross-check, F6 bounded simulated
call log, list/delete policy routes, last-write-wins on concurrent PUTs. EXT-002 (legal) and
EXT-003 (carrier) gate closure.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → #201 → #202 → #203 → this.

## Cycle 229 — TECH-015 F5 intent cross-check

`616379d` on `tech-015-f5-intent-crosscheck` (draft PR #205, stacked on #204) makes the sink verify
that `row.aggregate_id` and `payload.callIntentId` agree with the request's `call_intent_id` before
claiming, so a divergent pair no-ops as `intent_mismatch` instead of dialling evidence toward the
wrong intent. 3 tests, 230/230, tsc/eslint/prettier clean, CI PASS. Read-only worktree probe on both
sides of the fix, verdict ACCEPT (`management/TECH015_F5_REVIEW_RECORD.md`).

Remaining M04/M05 engineering, all non-blocking: list/delete policy routes, last-write-wins on
concurrent PUTs. EXT-002 (legal) and EXT-003 (carrier) gate closure.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → #201 → #202 → #203 → #204 → this.
Next engineering: the policy list/delete routes (`GET /tenant/policy` history, `DELETE` revert), then
last-write-wins on concurrent PUTs.

## Cycle 231 — `DELETE /tenant/policy` revert (PR #207)

The only unblocked engineering item left on the M04 policy track was the revert: `PUT` could
store an override that nothing could take away, so a tenant stayed on its last accepted policy
for good. `9cd4d3a` on `tech-014-delete-policy-route` (draft PR #207, stacked on #206) routes
`DELETE` before the body read, admin-scoped, tenant from the token only, idempotent (no row →
200 `reverted:false`, nothing audited), and audits `tenant_policy_reverted` with the removed
policy plus any violations so a corrupt row is reported instead of vanishing. 8 tests, 242/242,
tsc/eslint/prettier clean, CI PASS (run 46012046286). Worktree probe on both sides at
`management/TECH014_DELETE_REVIEW_RECORD.md`, verdict ACCEPT: pre-fix the revert returns 400
and the 07:00 override survives; fixed it returns 200 and the tenant is back on 09:00.

Remaining M04/M05 engineering: `GET /tenant/policy` history (needs a revisions table) and
last-write-wins on concurrent PUTs. Then the track is EXT-gated — EXT-002 (legal) and EXT-003
(carrier) gate closure, and nothing here places a live call.
Owner merge chain unchanged: #193 → #194 → #189 → #196 → #191 → #192 → #195, then
#197 → #198 → #199 → #200 → #201 → #202 → #203 → #204 → #205 → #206 → this.
Next engineering: the policy history route (revisions table + `GET /tenant/policy/history`).

## Cycle 232 — policy history route (PR #208)

The write surface's last blind spot: `GET /tenant/policy/history` over append-only
`tenant_policy_revisions` (migration 0011), one row per accepted write and per effective
revert, committed in the same transaction as the change. `ef3047c` is the code; 13 tests,
255/255, tsc/eslint/prettier clean; worktree probe ACCEPT
(`management/TECH014_HISTORY_REVIEW_RECORD.md`).

The probe also caught a **live 500 on every PUT and DELETE /tenant/policy**: the audit entry
used `actor_type: 'client'`, which the `audit_events` CHECK rejects; tests stubbed the logger
and never saw it. Fixed on #208. **#201…#207 are broken against a real database on their own
— do not merge that range without #208.**

Remaining M04/M05 engineering: last-write-wins on concurrent PUTs, revision retention/pruning.
Then the track is EXT-gated (EXT-002 legal, EXT-003 carrier). Owner merge chain: #193 → … →
#206 → #207 → this (#208).
Next engineering: last-write-wins on concurrent PUTs.

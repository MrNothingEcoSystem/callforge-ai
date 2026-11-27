# M04 increment 1 — pre-dial eligibility policy core

Cycle 218, 2026-11-27. Branch `m04-compliance-dial-gates`, draft PR #197.
Base `main` (not the #189 stack: new tree only, no overlap).

## What this is

`policies/dialEligibility.mjs` — a pure, fail-closed evaluator for the M04 gates G1–G5
and the rules behind them in `UAE_COMPLIANCE_REGISTER.md`. The register has been the
design since cycle 1; this is the first executable control, chosen because it is
unblocked (no owner gate, no carrier, no IdP) and because every later M05/M06 step
inherits a dial decision.

Contract: `evaluateDial({ now, campaign, contact, policy, attempts, timeZone })` →
`{ allowed, reasons[], warnings[] }`. No DB, no clock read, no network: replayable.

## Fail-closed positions

| Situation                            | Position                             |
| ------------------------------------ | ------------------------------------ |
| context missing / `now` unparsable   | `invalid_context`, deny              |
| campaign kind absent or unknown      | `r05_kind_unknown`, deny             |
| DNCR status absent or unknown        | `r06_dncr_unknown`, deny             |
| DNCR check older than 24h or undated | `r06_dncr_stale`, deny               |
| approval expiry unparsable           | `r01_approval_expiry_unknown`, deny  |
| time zone unusable                   | `r08_time_zone_unknown`, deny        |
| marketing campaign without a purpose | `r05_purpose_missing`, deny          |
| consent without a matching purpose   | `r05_consent_purpose_mismatch`, deny |

Window is `[09:00, 18:00)` Asia/Dubai — an 18:00:00 start is refused. Ceilings count
calls (2/day, 3/7d = the initial attempt plus Art.5(5)'s 1 callback/day, 2/week).

## Review changes

Independent read-only pass (record: `PR197_REVIEW_RECORD.md`) found F1: a missing
campaign purpose only warned, so purpose-bound consent matched vacuously and an opener
could be delivered without a stated purpose. Fixed at `5cb930c` with a block plus a
no-purpose-consent test.

## Explicitly not in this increment

- No wiring into `server.mjs` / `workflow/dispatcher.mjs`: needs the M03 dispatch path
  and a tenant licence/CLI registry (TECH-011).
- No DNCR provider sync (e&/du portal), no consent-store writes, no Kashif name match.
- No holiday-weekday handling: R08's Fri/Sat question stays LEGAL-REVIEW; the current
  code enforces the clock window only, all days, which is the conservative reading.
- Not legal advice. Every LEGAL-REVIEW threshold needs EXT-002 counsel sign-off.

## Follow-ups

- F2 (Low) attempts with a future `at` are ignored by the retry counter (clock skew
  under-counts retries) — clamp or count them.
- F3 (Low) `R01` tier text in `RULES` is a label, not a resolved Res.57 table entry.
- F4 (Info) `POLICY_DEFAULTS` is frozen but the ceilings are module constants; move to
  a tenant-overridable policy record at wiring time.

# policies/ — M04 compliance control cores

Pure, dependency-free policy evaluators for the rules in
`management/UAE_COMPLIANCE_REGISTER.md`. No DB, no clock reads: the caller passes
`now` and the facts, so every decision is reproducible and unit-testable.

`dialEligibility.mjs` is the pre-dial gate for M04 gates G1–G5. It is **fail-closed**:
absent, unrecognised or stale input denies the dial. It never defaults to allow.

| Reason code                                                                                     | Rule    | Register gate        | Res.57 tier                  |
| ----------------------------------------------------------------------------------------------- | ------- | -------------------- | ---------------------------- |
| `r01_no_licence`, `r01_approval_missing`, `r01_approval_expiry_unknown`, `r01_approval_expired` | R01     | G1 campaign approval | no approval 75k/100k/150k    |
| `r03_phone_invalid`, `r03_cli_missing`, `r03_cli_not_bound`                                     | R03     | G3 CLI binding       | unregistered CLI 25k/50k/75k |
| `r05_kind_unknown`, `r05_consent_missing`, `r05_consent_purpose_mismatch`                       | R05/R07 | G2 basis             | data/consent 50k/75k/150k    |
| `r06_dncr_listed`, `r06_dncr_unknown`, `r06_dncr_stale`                                         | R06     | G2 DNCR              | DNCR 50k/75k/150k            |
| `r08_outside_window`, `r08_time_zone_unknown`                                                   | R08     | G4 window            | per tier                     |
| `r09_global_opt_out`, `r09_offer_refused`                                                       | R09     | G5                   | per tier                     |
| `r10_retry_day`, `r10_retry_week`                                                               | R10     | G5 retry ceiling     | per tier                     |
| `invalid_context`                                                                               | —       | all                  | —                            |

Rules are applied by campaign kind, so a transactional callback is not held to the
marketing approval/consent/DNCR set while still enforcing CLI, E.164 and opt-out.

Boundaries are deliberate and conservative: the window is `[09:00, 18:00)` Asia/Dubai
(an 18:00 start is refused), DNCR freshness is 24h, and the R10 ceiling is 1 unanswered
call per 24h and 2 per 7d. Each is a named constant or `POLICY_DEFAULTS` entry, not a
literal buried in a branch.

Not legal advice. Thresholds the register marks LEGAL-REVIEW (Fri/Sat scope, retry
counting method, AI disclosure wording) are encoded as the conservative reading and
must be re-checked after counsel sign-off (EXT-002).

Not yet wired into the dialer: `server.mjs`/`workflow/dispatcher.mjs` call it once the
M03 dispatch path and the tenant licence registry land.

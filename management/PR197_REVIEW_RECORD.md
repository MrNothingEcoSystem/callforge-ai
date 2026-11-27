# PR #197 — independent read-only review record

Scope: head `161d36f` plus the remediation it prompted, cycle 218 (2026-11-27).
Read-only pass in a detached worktree; the only writes were the fixes themselves.

## Probes run

- Midnight rollover: Dubai 00:00 resolves to `hour: 0` (no `24`-hour `Intl` artefact),
  23:59 and 00:30 behave as expected. Window logic is wall-clock correct.
- Boundary set re-checked: 08:59 / 09:00 / 17:59 / 18:00 / 18:00:01 Dubai.
- Mutation: `endHour` 18 → 19 reds the boundary and defaults tests; reverting greens.
- Context matrix: absent kind, absent DNCR status, undated check, unparsable `now`,
  unparsable expiry, invalid zone, non-E.164 phone — all deny.
- Suite 151/151, eslint 0, prettier clean, tsc 0 at the reviewed head.

## Findings

- **F1 (Medium, fixed at `5cb930c`)** — `checkConsent` only compared purposes when both
  were present, and a purpose-less marketing campaign was a _warning_. So an opener
  could dial with a purpose-bound consent record never checked (R07/R11). Now
  `r05_purpose_missing` blocks and a consent record without a purpose is a mismatch.
- **F2 (Low, open)** — attempts with an `at` in the future are dropped by
  `attemptCount` (`age >= 0`), so clock skew can under-count the retry ceiling.
- **F3 (Low, open)** — the `RULES` tier strings are descriptive labels, not resolved
  Res.57 table lookups; fine for ranking, must not be quoted as the penalty.
- **F4 (Info, open)** — ceilings and window are module constants; a tenant-overridable
  policy record is needed before wiring.

## Verdict

**ACCEPT WITH FOLLOW-UPS.** The control is fail-closed in every path probed, the
negatives are real (each one reds without its guard), and F1 was the only behavioural
defect. Residual risk: the tier text and the Fri/Sat scope are engineering readings,
not counsel sign-off — M04 cannot close before EXT-002.

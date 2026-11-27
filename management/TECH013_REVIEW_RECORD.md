# TECH-013 tenant policy record — review record

Head reviewed: `3c11bf8`. Self-review pass in cycle 221; independent read-only pass appended
below in cycle 222.

## Verdict: ACCEPT WITH FOLLOW-UPS

## Probes

1. No row → `source: 'default'`, options exactly `POLICY_DEFAULTS` (test).
2. Row `start=18, end=9` (passes the CHECKs, semantically inverted) → `options: null`, one
   violation; evaluator on the same options returns exactly `['invalid_policy']` (test).
3. Window widened to 07:00 moves an 08:00 local dial from denied to allowed while the
   statutory window still denies it (mutation pair, test).
4. DNCR age 2h turns a 4h-old check stale; `day: 1` denies on one prior unanswered call (test).
5. End-to-end: stored policy reaches `policy_json` as a snapshot and dispatch allows the early
   dial that defaults would deny (test).
6. Full suite 186/186 `--pool=threads`, tsc 0, eslint 0, prettier clean.

## Findings

- F1 (Low, real): `requestDial` (non-resolving producer) does not consult the record; only
  `requestDialResolved` does. A caller on the older path silently gets statutory defaults.
- F2 (Low): whole-hour windows only.
- F3 (Low): no write surface outside the module — dashboard/API still owed.
- F4 (Info): `checkWindow` now receives the option object, so a future caller could pass an
  unvalidated shape directly; the evaluator re-validates, which is the guard.

No blocker. Note the snapshot means a later policy change does not retroactively re-gate a
pending request — deliberate (reproducibility), worth stating for the dashboard.

## Independent pass (cycle 222, 2026-11-27)

Scope: the cycle-221 diff against `tech-012-fact-sources` (`0007_tenant_policy.sql`,
`policies/tenantPolicy.mjs`, the `dialEligibility.mjs` option plumbing, the `dialGate.mjs`
snapshot) plus test corpus, in a detached worktree. Read-only except the remediation of F5.

### F5 (Medium, real, fixed at this head) — a corrupted stored row fell back to the _wider_ defaults

`readTenantPolicy` correctly returns `options: null` for a row that fails validation, and
`evaluateDial` denies on `invalid_policy` — but only when it receives an object. On the real
path the null was passed through `requestDialResolved` → `policy_json` → `dispatchDialRequest`
→ `evaluateDial`, where `if (rawOptions)` treated `null` like "absent" and substituted
`POLICY_DEFAULTS`. With a row inverted to 18–9 (passes the column CHECKs), a 10:00 local dial
was **allowed** under the statutory 09:00–18:00 window instead of denied. Docstring and ledger
claim the opposite ("an out-of-range value denies rather than silently widening the gate").

Proven with a probe (insert the inverted row, request, dispatch → `allowed: true`), then fixed
by distinguishing `undefined` (no tenant record — defaults are correct) from `null` (a record
that failed validation — deny). The denial detail uses the snapshotted `policyViolations`, so
the row's actual defects are named rather than a generic message. Two tests added: the unit
contract (`undefined` allows, `null` denies `invalid_policy`) and the end-to-end corruption
path; both fail on the pre-fix evaluator (verified by reverting the one condition).

### Re-checked and sound

- `writeTenantPolicy` validates before the upsert and throws `RangeError`, so the API cannot
  store an unusable row; the corruption vector is a hand edit / migration, which the read
  re-validation now catches on the decision path.
- Absent row still means defaults (no behaviour change for tenants without a record).
- `retry_limit_day > retry_limit_week`, hour > 24, DNCR age outside 1–168h and an empty
  `time_zone` all deny; the migration CHECKs agree with the validator bounds.
- Snapshotted options mean a mid-flight edit cannot re-gate a pending dial; the legacy
  `requestDial` producer passes no `options` and stays on defaults (F1 stands, now explicit).

### Remaining, non-blocking

- F1 (unchanged): legacy `requestDial` producer ignores the record.
- F2 (unchanged): whole-hour windows; Res.57 half-hour windows need EXT-002 before widening.
- F3 (unchanged): no write surface (dashboard/API).
- F6 (new, Low): `dialEligibility.mjs` ⇄ `tenantPolicy.mjs` are mutually importing; it works
  because every cross-reference is deferred to call time, but a future top-level use would hit
  a TDZ error — moving `POLICY_DEFAULTS` into a neutral module would remove the cycle.
- F7 (new, Low): `POLICY_DEFAULTS` is only shallow-frozen and `readTenantPolicy` shallow-copies
  it, so a caller mutating `options.callingWindow` would mutate the module default.

Gates after the fix: 188/188 (`--pool=threads`), tsc 0, eslint 0, prettier clean.

## Verdict (independent pass): ACCEPT WITH FOLLOW-UPS — F5 fixed in-cycle, F1/F2/F3/F6/F7 open

# TECH-013 — tenant policy record (review #197 F4)

## Problem

`policies/dialEligibility.mjs` hard-coded the calling window (09:00–18:00 Asia/Dubai),
the retry ceiling (2/day, 3/7d) and DNCR freshness (24h). Review F4 on PR #197: those are
the statutory *defaults*, but every tenant's competent-authority approval names its own
window and ceilings, so a single constant set silently mis-gates every tenant but the first.

## Change

- Migration `0007_tenant_policy.sql`: `tenant_policies`, one row per tenant, defaults equal
  to the statutory set, CHECK ranges as belt-and-braces.
- `policies/tenantPolicy.mjs`: `validatePolicyOptions` (pure), `readTenantPolicy`,
  `writeTenantPolicy`. Absent row = defaults (`source: 'default'`). A row that is present but
  unusable returns `options: null` + violations.
- `evaluateDial` accepts optional `ctx.options`, re-validates it, and returns a single
  `invalid_policy` denial rather than falling back to wider defaults.
- `requestDialResolved` snapshots the tenant's options into `policy_json`, so the decision
  stays reproducible if the record is edited between request and dispatch. `dispatchDialRequest`
  supplies the snapshot.

## Fail-closed rules

Inverted or empty window, hour outside 0–24, day/week outside 1–10 / 1–20, day > week,
DNCR age outside 1–168h, empty time zone → unusable. `writeTenantPolicy` throws; the reader
and evaluator deny.

## Limits / follow-ups

- F1: the older `requestDial` producer does not load the record — a caller using it still
  gets defaults unless it passes `options` itself. Acceptable while `requestDialResolved` is
  the documented path; fold it in when the M05 sink lands.
- F2: windows are whole hours; half-hour windows (e.g. 09:30) need minute fields.
- F3: there is no HTTP/admin surface to write a policy — the dashboard is the natural owner.
- F4: 168h is the DNCR ceiling here; whether a marketing campaign may ever exceed 24h is an
  EXT-002 legal question, so it is a range, not a constant.
- Not a licensing fact: the record configures thresholds only; R01 licence/approval facts
  still come from the tenant record.

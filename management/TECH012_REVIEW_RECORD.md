# TECH-012 review — DNCR/consent fact sources

Cycle 220 independent pass, 2026-11-27, read-only detached worktree at `5c02789`.
Scope: `0006_fact_sources.sql`, `sources/*`, the `requestDialResolved` producer, the
test corpus and the ledger. Verdict: **ACCEPT WITH FOLLOW-UPS**.

## Checked and sound

- Fail-closed shape holds on every path: no source → `unknown`; provider throw → `unknown`
  with `checkedAt: null`; unrecognised provider status → `unknown`. `unknown` is never
  upgraded to `clean`, so an outage denies marketing dials instead of guessing.
- Freshness is stamped from this side's clock, and a future-dated cache row counts as stale
  — a provider with a skewed clock cannot buy freshness.
- Exact-purpose consent is tried before the latest-for-another-purpose row, so the gate
  reports `r05_consent_purpose_mismatch` instead of a misleading absence. A withdrawn row
  is returned (not skipped) and denied by the evaluator.
- Consent grants require an `evidenceRef`; withdrawal is idempotent (`false` when nothing
  was live) and a re-grant clears `withdrawn_at`.
- Cache is keyed per tenant, so one tenant's answer cannot authorise another's dial.
- `requestDialResolved` snapshots the _resolved_ contact; a caller claim of `clean` is
  overwritten by the provider answer (pinned by a test that stores `listed`).
- Migration is additive, matches the existing FK/style conventions, and the migration-set
  test derives its expectation from `listMigrations()` so `0006` is picked up without edits.
  No test weakening found in `tests/m04-fact-sources.test.mjs`.

## Findings

- **F1 (Medium, fixed at this head)** — a requested `ttlHours` above the evaluator's 24h
  freshness limit produced a cache hit the gate then rejected as `r06_dncr_stale` forever
  (probe: `ttlHours: 48`, answer 26h old → `cached: true`, provider called once). The TTL is
  now clamped to `POLICY_DEFAULTS.dncrMaxAgeHours` and exposed clamped; test added.
- **F2 (Low, fixed at this head)** — intent existence/tenant was validated inside
  `requestDial`, i.e. _after_ resolution, so a typo'd intent id still spent a provider call
  and wrote a cache row. Now validated before resolving; test asserts no provider call.
- **F3 (Low, open)** — the cache key is (tenant, phone) without a provider/version component,
  so swapping the DNCR provider reuses the previous provider's answers until the TTL lapses.
  The row does keep the answering reference. Add a provider id to the key when a second
  provider exists.
- **F4 (Info)** — resolution runs outside the insert transaction; two simultaneous identical
  producers both resolve and the unique index decides (probe: one insert, one `inserted:
false`, no throw). Same shape as `requestDial`; acceptable at producer rates.
- **F5 (Info)** — a denial is terminal (#198 F4) and there is no "re-query DNCR now" path, so
  a stale/unknown denial needs a fresh idempotency key. Belongs with the compliance
  dashboard's retry action.
- **F6 (Info)** — `dncr_checks` keeps rows for withdrawn tenants until cascade; no pruning
  job by design.

## Probes run

TTL clamp (red before fix, green after), bogus-intent provider-call count (1 before fix,
0 after), concurrent duplicate produce, and a mutation forcing the provider-error path to
`clean` (reds exactly the outage unit test and the end-to-end outage denial). Full suite
after remediation: **179/179**, tsc 0, eslint 0, prettier clean.

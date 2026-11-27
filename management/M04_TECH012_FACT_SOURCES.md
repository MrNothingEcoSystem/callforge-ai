# TECH-012 — DNCR and consent facts from sources of record

Cycle 220, 2026-11-27. Branch `tech-012-fact-sources`, draft PR stacked on #198
(which stacks on #197). Base is `tech-011-dial-gate-wiring`: the resolver feeds the
gate that branch wired in.

## Why

The gate evaluates snapshotted facts, but until now the **caller** supplied them. A
producer that passed `dncrStatus: 'clean'` with no check behind it was indistinguishable
from one that had really queried the registry, and a withdrawn consent only counted if
every caller remembered to update its copy. That makes the gate's verdict as good as the
caller's bookkeeping rather than as good as the record.

## What landed

- `db/migrations/0006_fact_sources.sql` — `consents` (unique per tenant+phone+purpose,
  `granted`/`withdrawn`, evidence reference, grant/withdraw timestamps), `opt_outs`
  (`offer`/`global`, unique per tenant+phone+scope) and `dncr_checks` (TTL cache of
  provider answers with the answering reference).
- `sources/consent.mjs` — `recordConsent` (refuses a grant without `evidenceRef`, because
  R05 is a consent-_record_ rule), `withdrawConsent`, `lookupConsent`, `recordOptOut`,
  `readOptOuts`. A global opt-out implies the offer one.
- `sources/dncr.mjs` — `createCachedDncrSource(db, { provider, ttlHours = 24 })`; the TTL
  is clamped to the evaluator's 24h freshness limit so a longer poll interval cannot serve
  an answer the gate rejects as stale (review F1). Provider
  contract is `check({ tenantId, phone }) → { status, reference }`. The timestamp is taken
  from this side's clock when the answer arrives, so a wrong provider clock cannot buy
  freshness. A future-dated cache row is treated as stale.
- `sources/facts.mjs` — `resolveContactFacts()` composes consent, opt-outs and DNCR into
  the contact shape the evaluator takes. Exact-purpose consent first; otherwise the latest
  row for another purpose, so the gate reports `r05_consent_purpose_mismatch` instead of a
  bare absence.
- `workflow/dialGate.mjs` — `requestDialResolved()` resolves, then delegates to
  `requestDial` with the resolved contact, so the snapshot records what the sources said
  (`resolvedBy: 'sources'`, `dncrReference`, `consentEvidenceRef`) rather than what the
  caller claimed. It is async because a DNCR check is; the synchronous `requestDial` is
  unchanged for callers that legitimately hold the facts already.

## Fail-closed rules pinned by tests

| Case                                   | Result                                               |
| -------------------------------------- | ---------------------------------------------------- |
| provider throws / timeout              | `unknown`, `dncrCheckedAt: null`, later denied       |
| provider returns an unknown string     | `unknown` (`provider_unrecognised_answer`)           |
| no DNCR source configured              | `unknown` (`no_dncr_source`)                         |
| cache hit inside 24h                   | provider not called again                            |
| cache older than 24h, or future-dated  | re-queried                                           |
| consent withdrawn / other purpose only | denied R05 (mismatch reported when known)            |
| global opt-out                         | `optedOut` + `optOutGlobal` true                     |
| resolved `listed`                      | denied R06, no `call.dial` even if caller said clean |

`unknown` never upgrades itself to `clean`: an outage denies marketing dials and the
denial is visible in `reasons_json` for the compliance dashboard.

## Still open

- No real registry integration. The seam is the provider interface; which vendor/portal
  the owner uses (and its credentials) is EXT-003. `createStaticDncrProvider` is fixture
  only, not evidence.
- Consent is local-of-record. A customer portal or CRM writes here; the pull/import
  direction is TECH-013 territory.
- Licence/CLI inventory is still passed per request, not stored per tenant (#197 F4).
- Denial is terminal (#198 F4); a "re-query DNCR now" action belongs with the dashboard.
- Not legal advice; EXT-002 owns the 24h freshness and retry thresholds.

## Gate result

`vitest run --pool=threads` **179/179** (16 files, +16 tests), eslint 0,
tsc 0, prettier clean. Mutation: forcing the provider-error path to `clean` reds exactly
the outage unit test and the end-to-end outage denial; restored, green.

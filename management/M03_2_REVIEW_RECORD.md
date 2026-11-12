# CALLFORGE OMEGA — M03-2 Independent Review Record

PR #20, exact head `e21b341fcec0ca1ff8e16180450c609b6030c89e` ("style: prettier-format m03-orchestration tests"),
parent `2746ee5`. Review date 2026-11-09. Reviewer: independent (adversarial probes + targeted regression tests).

## Remediation pass (F1–F6) — pending re-review

Fixes applied after the REJECT above (commit hashes recorded in the re-review section below):
F1 webhook `received → processing → processed` is now transactional and idempotent
(`workflow/dispatcher.mjs`); crash/lease-reclaim redelivery completes to `processed`.
F3 `audit_events` is excluded from destructive retention (`RETENTION_PROTECTED`); the chain
verifies before and after `executeRetention()`. F2 recovery reclaims NULL-lease claims.
F4 webhook bodies are bounded by `MAX_WEBHOOK_BODY_BYTES` (default 1 MiB, 413 before HMAC).
F5 provider identifiers are restricted to a single segment (400 otherwise).
F6 dispatcher `start()` is idempotent and re-checks the env gate on every call.
New tests: crash-between-processing-and-ack, idempotent redelivery, stale-vs-fresh leases,
audit-chain before/after retention, late-enable, HTTP 400/413/401/202/200 cases.

## Verdict: **REJECT — remediation and re-review required** (1 blocking defect, 1 major design conflict)

REJECTED, not ACCEPTED. Re-review required at the remediated head before any merge decision.

## Verified sound (probes at e21b341)

- Concurrent workers: two dispatchers calling `dispatchOnce()` in parallel claimed disjoint rows; no double-delivery, all rows acked once.
- Quota atomicity: 20 sequential `consumeQuota` calls against limit 5 → exactly 5 consumed, `used=5`, never over limit. Release works.
- Retry exhaustion: failing row claim/cycle → `status='dead'` at exactly 5 attempts with `last_error` recorded.
- HMAC webhook (live HTTP probe): bad sig → 401 with 0 rows stored; good sig → 202; exact replay → 200 same id, 1 row; short/empty sig → 401.
- Replay: identical body dedups by content hash; different body with same `x-dedup-key` preserves the first body (idempotent, no overwrite).
- Double retention gate: report-only unless both `RETENTION_ENABLED=1` and `RETENTION_DRY_RUN=0`.
- `/ready` returns 200 with `recovery:true` only after `initialize()` ran recovery.
- Interrupted `receiveWebhook` leaves outbox row consistent (transactional store).

## BLOCKING: F1 — Webhook 'processed' state unreachable (component 4 unmet)

- Severity: C2 — blocks acceptance.
- Reproduction: `receiveWebhook(...)` → `dispatchOnce()` with `OUTBOX_DISPATCHER_ENABLED=1` → webhook row is `processing`; `runReconciler()` reports `stuck_webhooks >= 1` permanently. No code path in `workflow/dispatcher.mjs`, `workflow/webhookInbox.mjs`, or `server.mjs` ever sets `status='processed'` (`grep "processed"` across the tree returns only the CHECK constraint and the reconcilers' status filter). The M03-2 plan requires the dispatcher to drive `received → processing → processed`.
- Reference: `2746ee5` `workflow/dispatcher.mjs` `handleWebhook`.
- Required remediation: drive terminal reconciliation to `processed` (or record terminal `failed` with `last_error` on exhausted retries) and add a regression test asserting `processed` after a successful dispatch cycle. Re-review at the new exact head.

## MAJOR (design): F3 — Retention permanently deletes `audit_events`, breaking the audit chain

- Severity: M — requires a recorded decision before activation, even gated.
- Reproduction: seed audit row → `RETENTION_ENABLED=1 RETENTION_DRY_RUN=0` → `executeRetention()` → audit row count `1 → 0`. Cross-row hash-chain (`audit.mjs` `verifyChain` / `getChainHead`) can no longer verify the chain after deletion; deletion of the whole chain silently resets the genesis anchor.
- Reference: `2746ee5` `workflow/quota.mjs` `RETENTION_DELETE_SQL.audit_events`.
- Required remediation (one of): exclude `audit_events` from retention deletes (archive-then-delete with chain anchor export), or document the audit-chain impact as an accepted risk signed by the owner. Until decided, the double gate must remain closed by default.

## MINOR: F2 — Recovery ignores claimed rows with NULL lease

- Severity: L. Reproduction: claim a row, set `lease_expires_at=NULL` → `runRecovery()` reclaims 0 (it filters `lease_expires_at IS NOT NULL`). Such rows are stuck in `claimed` forever. Remediation: also reclaim `claimed` rows with NULL lease.

## MINOR: F4 — Webhook body has no size limit

- Probe: signed 5 MB body accepted (202). Add a `MAX_WEBHOOK_BODY_BYTES` guard (e.g. 1 MiB) returning 413 before HMAC. Low severity in a non-exposed simulation baseline; required before any network exposure.

## MINOR: F5 — Provider path segment accepts slashes

- Probe: `POST /webhook/a/b` stores provider `a/b`. Validate a single segment (`^[a-z0-9_-]+$`) and 400 otherwise.

## MINOR: F6 — Dispatcher starts only at `initialize()`

- If `OUTBOX_DISPATCHER_ENABLED` is toggled after server start, the timer never starts (`start()` is called once, from `initialize()`). Document or re-check at `start()`.

## INFO: `consumeQuota` with `limit_value=0` is unlimited

Consistent with `checkQuota` (allowed when limit ≤ 0), but undocumented in code comments. Footgun if a `0` limit is ever intended as deny-all. Document the semantic.

## Coverage check of the 92 → 98 tests

The original 92 tests did not cover: HTTP webhook status codes, replay, concurrent claiming, retry-to-dead, processed-state reachability, NULL-lease recovery, retention-vs-audit-chain, body size, provider validation, `stop()` semantics, or re-enabling the dispatcher after start. Six regression tests were added in `tests/m03-orchestration.test.mjs` (`Concurrent claims disjoint; retry exhaustion to dead; webhook replay dedup; F1 pinning test; F2 pinning test; limit=0 semantics`). Full suite: 98/98 at `e21b341`+tests.

## Branch protection proposal for `main` (not applied — requires owner authorization)

1. Enable branch protection on `main` (currently none; verified via API 404 on the protection endpoint).
2. Require pull-request reviews: 1 approval (2 for `server.mjs`/`oauth.mjs`/`workflow/*` paths, if codeowners are configured).
3. Require status checks to pass: `verify` (the single existing CI job) before merging.
4. Require branches to be up to date / mergeable clean; block force pushes and deletions.
5. Restrict who can push to `main` to PR merges only; enable "enforce for admins" only after confirming break-glass access (admin user `Davidcarmelalex`).
6. Required conversation resolution before merge.

Trade-off: if rulesets (instead of legacy protection) are preferred, the same settings apply as a repository ruleset for `main`. Either way, this must be set before M04/M09 production-critical work. SEC-001 stays open regardless.

## Re-review (2026-11-09) — **ACCEPT**

Re-reviewed at remediation head `8ef939bd80b5be572026e4754f795f481ef748fb` from a fresh clone
(`git clone`, detached at that SHA), 108/108 tests, hosted CI PASS (run 42576201523).
Independent probes at 8ef939b:

- F1: webhook reaches `processed` with `processed_at`; crash-between-processing-and-ack →
  recovery + redelivery completes to `processed`, outbox `acked`; two concurrent dispatchers →
  5/5 processed, no double-processing; reinspector `stuck_webhooks=0`.
- F3: `executeRetention()` with the double gate open deletes 0 audit rows
  (`excluded: audit_chain_protected`); `verifyChain()` valid before and after.
- F2: NULL-lease claimed rows reclaimed; stale reclaimed, fresh preserved.
- F4/F5: handler returns 413 oversize, 400 malformed provider, 401 malformed signature,
  202 valid, 200 replay (mock-handler tests).

**Verdict: ACCEPT.** M03-2 meets the plan's acceptance bar (crash-recovery proof, quota never
over limit, retention never deletes without both flags, /ready gating, timers don't block
shutdown). Merge decision remains with the owner. SEC-001 stays OPEN. Archive/retention
policy for audit_events must still be owner-approved before any deletion is ever enabled.

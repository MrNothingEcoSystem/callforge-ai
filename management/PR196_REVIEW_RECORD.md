# PR #196 — Independent Review Record (TECH-004 audit `seq` hedge)

Reviewer: CALLFORGE OMEGA dispatcher (self-review; `delegate_task` unavailable in cron
runtime). Date: 2026-11-27. Base reviewed: `cleanup/issues-2-4-5-6` @ 0a139db. Reviewed
head: 41ed347 (`tech-004-audit-seq-hedge`), re-reviewed at remediation commit below.

## Scope checked

- `db/migrations/0004_audit_seq.sql` — column, backfill, unique index, insert trigger.
- Every `audit_events` read site in product code (`audit.mjs` head, verify range,
  predecessor probe, `getEvents`, plus a repo-wide `grep -rn rowid` sweep).
- `tests/audit.test.mjs` seq test; `tests/m03-workflow.test.mjs` migration-set assertion.
- Restore path (`scripts/backup.mjs` is a file-level `VACUUM INTO`/copy, so `seq`,
  index and trigger travel inside the file — no NULL-`seq` window on restore).
- Migration runner wraps each file in `db.transaction` (`db/migrate.mjs`), so a crash
  between the `ALTER` and the index cannot leave a half-applied schema.

## Verdict: ACCEPT WITH FOLLOW-UPS

The hedge does what D-008 requires: the chain's ordering key becomes an explicit column
whose only engine-specific part is the allocator, and the added test proves reads follow
`seq` by inverting `seq` while leaving `rowid` untouched. The hash preimage is unchanged,
so existing chain heads stay valid.

## Findings

| ID  | Severity                                     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                                                                                         |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Medium (incomplete claim, no live bug today) | The PR states every reader now orders by `seq`, but `workflow/stateMachine.mjs` `transition()` still minted its audit event from `SELECT ... ORDER BY rowid DESC` — the one remaining SQLite-only read site in product code. `rowid DESC` happens to equal `seq DESC` in normal operation, so nothing is broken today, but a Postgres port would leave the transition path on an engine-owned key, and a reordered `seq` would link transitions to the wrong predecessor. | **Fixed in this branch** — one-line change to `ORDER BY seq DESC` + regression test that forces `seq`/`rowid` to disagree and asserts the transition links to the `seq` head (verified failing before the fix) |
| F2  | Low                                          | `m03-workflow` derives its expected migration set from `listMigrations()`, so an empty scan would make the assertion vacuous (`[] === []`).                                                                                                                                                                                                                                                                                                                               | **Fixed** — asserts `>= 4` migrations and that `0004` is present                                                                                                                                               |
| F3  | Low (accepted)                               | `seq` is nullable. Only reachable if the trigger is dropped or a caller supplies `seq` explicitly; `insert` always hits `WHEN NEW.seq IS NULL`. Dropping nullability needs a table rebuild in SQLite.                                                                                                                                                                                                                                                                     | Documented; follow-up for the M03 table-rebuild increment                                                                                                                                                      |
| F4  | Low (accepted)                               | `MAX(seq)+1` under a unique index means a concurrent second writer fails loudly on collision rather than mis-ordering. Matches the documented single-writer claim.                                                                                                                                                                                                                                                                                                        | Documented; revisit with the port (real sequence object)                                                                                                                                                       |
| F5  | Nit                                          | The backfill uses a correlated `COUNT(*)` (`O(n²)`); fine at current row counts, slow on a large production table.                                                                                                                                                                                                                                                                                                                                                        | Follow-up: `ROW_NUMBER()` window function if `audit_events` grows                                                                                                                                              |
| F6  | Nit                                          | The new `audit.test.mjs` test mutates `seq` in place and does not restore it; a test appended after it must not assume `seq` order equals insertion order.                                                                                                                                                                                                                                                                                                                | Documented in the test comment                                                                                                                                                                                 |

## Evidence

- Pre-remediation 41ed347: 117/117 pass, lint/tsc/prettier clean, CI verify SUCCESS (run 45934694680).
- Fix discrimination probe: with `stateMachine.mjs` reverted to `rowid DESC` the new test
  fails (1 failed / 11 passed); with the fix it passes (12/12).
- Post-remediation: 118/118 pass, eslint 0, tsc 0, prettier clean; CI result recorded on
  the remediation head in the execution log.
- Pool note for future local gates: the pre-existing TECH-009 `better-sqlite3` 11.10
  teardown `SIGABRT` is fork-pool specific — `vitest run --pool=threads` is clean, plain
  `vitest run` loses whole workers (84/117). Drop the flag after #193 lands.

## Residual risk

`seq` is not signed, so a database-level actor can still reorder or gap the chain; the
hash links catch a reordered chain on `verifyChain` but not a silent `seq` edit that
preserves order. Signed checkpoints (issue #190 option 2) remain the owner's
archival-policy half of the decision.

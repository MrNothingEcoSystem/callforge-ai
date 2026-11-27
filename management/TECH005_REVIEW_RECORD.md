# TECH-005 — dispatcher crash-recovery proof (review record)

- **Item:** TECH-005 — "CALLFORGE dispatcher not yet proven over 2 cycles". Open since
  cycle 1; `dispatcher.cycles_proven` is still 1. Everything else local on the program is
  Info-level polish on PR #192 or owner-gated, so this was the highest-priority unblocked
  item.
- **Head reviewed:** `79a3488`, read-only, detached worktree
  (`/root/.hermes/cache/scratch/cf214/rev`), `pnpm install --frozen-lockfile`.
- **Diff:** `28c9040..79a3488` — 2 new files only (`tests/m032-crash-recovery.test.mjs`,
  `tests/fixtures/m032-crash-worker.mjs`). **No production source, dependency, workflow
  enforcement value or schema changed**, so the existing suite cannot move.
- **Reproduced:** the new test passed twice consecutively in the review worktree (1/1 each).
  In the authoring worktree it passed three consecutive runs, and the history of the test
  shows the two earlier shapes failed for a real reason (whole-batch stranding on crash),
  not for timing.

## What the test actually proves

Each "cycle" is a separate OS process against a real SQLite file. It produces 3 outbox
rows plus 1 `webhook.received` row, claims the batch, applies the first effect and calls
`process.exit(9)` **before** the ack — so the whole claimed batch is stranded, which is
worse than the single-row case. Then, across two cycles:

- a live 60s lease is **not** reclaimed by `runRecovery()` and `claimBatch()` does not
  re-claim it (`reclaimed_leases === 0`, `acked === 0`);
- after the lease is forced expired, recovery reclaims exactly the claimed set and the
  redelivered row completes;
- the keyed effect stays **exactly one** across redelivery (`INSERT OR IGNORE` marker), so
  delivery is at-least-once and the effect exactly-once;
- the crashed `webhook.received` row ends `processed` exactly once and is never stuck;
- the final state has all four rows `acked`, three effects, and `attempts >= 2` on the
  redelivered rows — nothing left pending or claimed.

Mutation check performed by the author: neutering the reclaim predicate in
`workflow/recovery.mjs` (`AND 0`) fails the test with `expected +0 to be 4`; the file was
restored afterwards (not part of the diff).

## Verdict

**ACCEPT.** The test is behaviour-pinning, source-neutral and rebasable; it converts
TECH-005's claim into something CI can regress. No new defect.

## Residuals (Info)

- **I1** — the proof is one-process-per-cycle at the module level, not a spawned
  `server.mjs`; it exercises the dispatcher, outbox, recovery and webhook modules directly.
  Socket/HTTP startup is covered elsewhere (`server.test.mjs`).
- **I2** — `crash_effects` is a fixture-local table, deliberately not in `db/migrations`;
  a future durable-effect table would not reuse it.
- **I3** — the test asserts `attempts >= 2` on redelivered rows but not an exact bound;
  MAX_ATTEMPTS/backoff ceilings are covered by `m03-orchestration.test.mjs`.
- Base note: `main` still pins `better-sqlite3` 11.10, so the raw full suite loses workers
  to TECH-009 (178 passed / 244 collected, 2 aborts). The same head merged with
  `origin/fix/tech-009-sqlite-worker-abort` runs **23/23 files, 256/256, exit 0**.

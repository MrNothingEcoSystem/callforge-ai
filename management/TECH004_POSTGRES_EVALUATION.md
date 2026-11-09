# TECH-004 — PostgreSQL vs SQLite Evaluation (M03 design deliverable)

Date: 2026-11-09 (cycle 4) · Status: evaluation complete, decision pending owner acceptance · No migration implemented

## Scope and evidence

Evaluated against main `75b191acff9cde5a3e8ee6d62033fcd80380a7c2` (`store.mjs`, 387 lines, better-sqlite3) and M03 branch `origin/m03-durable-workflow` head `6c0ffb9876a35d473acb8ccaeda709ba0c2970dd` (`db/migrations/0001..0003`, `workflow/outbox.mjs`, `workflow/quota.mjs`, `workflow/stateMachine.mjs`, `workflow/webhookInbox.mjs`, `scripts/backup.mjs`). Baseline tests this cycle: 58/58 passed (Node v24.22.2, pnpm 12.18.0).

## Current SQLite posture

- Single-file store (`CALLFORGE_DB_PATH` / `data/callforge.db`), WAL + `synchronous=NORMAL` + FK on, synchronous better-sqlite3 driver, prepared statements discarded after construction (no retained statement cache).
- Schema (main): tenants, users, api_keys, call_intents, call_events, audit_events, business_configs, knowledge_entries, conversation_fixtures. M03 adds: outbox, call_state_transitions, webhook_inbox, provider_events, tenant_quotas, retention_policies.
- SQLite-isms that do not port verbatim: `datetime('now')` defaults, partial unique index on `outbox(tenant_id, dedup_key) WHERE dedup_key IS NOT NULL`, JSON stored as TEXT, integers as booleans, `INSERT OR IGNORE` seeding, `db.pragma()`, file backup/restore in `scripts/backup.mjs`.
- Known SQLite-specific risks already recorded: F-M03-05 chain-head read and single-writer claim are SQLite-specific; outbox claiming (`claimBatch`) and quota counters assume one writer process.

## Evaluation criteria

| Criterion                        | SQLite (current)                                                                                            | PostgreSQL                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Multi-instance / HA              | Single writer; WAL allows concurrent readers only. Two app instances on one file = corruption/locking risk. | Native multi-instance, row-level locking, `SELECT ... FOR UPDATE SKIP LOCKED` for outbox claiming.                   |
| Outbox dispatcher (M03-2)        | Acceptable for one dispatcher process; lease reclaim needs careful single-writer guard.                     | Correct primitive for competing dispatchers; no app-level lock needed.                                               |
| Audit chain (hash-linked events) | Chain-head read must be serialized; fine single-writer, racy multi-writer.                                  | `SERIALIZABLE` tx or advisory lock per tenant gives a clean chain-head primitive.                                    |
| Quota counters (F-M03-04)        | Atomic `UPDATE ... SET used = used + 1` works single-writer.                                                | Same, plus multi-writer safe. Fail-open default question (F-M03-04) is identical on both — decide policy separately. |
| JSON / search                    | TEXT + app-side parse; no native JSON queries.                                                              | `jsonb` + GIN indexes for payload/webhook filtering (M05/M07 will need this).                                        |
| Ops / backup                     | File copy; trivial locally, no PITR, no replication.                                                        | `pg_basebackup` / WAL archiving, PITR, managed UAE-region options (ties to EXT-004 hosting decision).                |
| Test/dev ergonomics              | Zero-config, deterministic, fast (58 tests ~1.4s).                                                          | Needs a running server or testcontainers; CI must provision Postgres.                                                |
| Cost / footprint                 | Zero.                                                                                                       | Managed Postgres is a recurring cost — requires owner spend approval (never spent without authorization).            |

## Recommendation

1. **Keep SQLite as the system of record for the simulation baseline** (current phase, M02/M03 review, single-instance CI). No migration now.
2. **Adopt PostgreSQL before M03-2 goes multi-instance and before M05 live telephony** — i.e. the decision gate is the first deployment that runs more than one writer (dispatcher + API) or needs PITR. That gate is EXT-004-adjacent and needs owner approval; it is not triggered by this evaluation.
3. **Pay down portability debt now, on the M03 branch, without migrating** (bounded follow-ups, in dependency order):
   - a. Replace `datetime('now')` defaults with app-supplied ISO timestamps (or a `now()` abstraction) in new migrations.
   - b. Move chain-head reads and `claimBatch` behind a store interface so the Postgres implementation is a swap, not a rewrite (addresses F-M03-05).
   - c. Keep all SQL in `db/migrations/*.sql`; never embed DDL in application code (already the M03 pattern — hold it).
   - d. Decide F-M03-04 (checkQuota fail-open vs fail-closed) as a policy choice independent of engine.
4. **Migration shape when the gate opens** (estimate only, not authorized): dual-write/shadow period is unnecessary at current scale; a one-shot `pg_dump`-style ETL of the 15 known tables plus re-seeded fixtures, with hash-chain re-verification (`verifyChain`) as the acceptance check. Revisit the estimate once M03-2 lands, because outbox volume changes ETL effort.

## What this does not decide

- SEC-001 IdP choice, M02/M03 merge order, EXT-004 hosting region/vendor, or any spend. All remain owner-gated.
- F-M03-01 (webhook signature verification) is engine-independent and stays on the M03-2/M05 track.

## Verdict requested

Owner accepts (a) SQLite retained for baseline, (b) Postgres gate before multi-writer/live, (c) portability follow-ups a–d scoped into M03-2. No code, merge, deploy, or spend is authorized by this document.

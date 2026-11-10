# TECH-004 — PostgreSQL vs SQLite Evaluation (Design Deliverable)

**Program:** CALLFORGE OMEGA — Project Ascension
**Directive:** D-006 (management/ASCENSION_DECISIONS.md)
**Status:** Delivered — design evaluation only; no migration commitment
**Branch:** tech-004-postgres-vs-sqlite-design
**Base:** main `28c90405b5da65807b9139f05ce0f30bc232bcfe` + reconciled cycle-40 ledger `38f34f6a3f347e345bf2fa2f4adbefcb27f8a522`

## 1. Scope

Pre-migration design evaluation only. This document records the PostgreSQL-versus-SQLite evaluation required before any migration commitment. It does NOT authorize migration, deployment, spend, live calls, or any change to the system of record. All external gates (EXT-002, EXT-004, et al.) remain owner-gated and unchanged by this deliverable.

## 2. Governing decision (D-006)

SQLite remains the system of record for the simulation baseline. PostgreSQL evaluation is an M03 pre-migration design deliverable. Any migration requires a new milestone branch + draft PR, exact-head CI evidence, independent review, and owner authorization (EXT-004 production hosting + deployment approval is still open).

## 3. Current baseline (SQLite)

- **store.mjs / db/migrate.mjs**: embedded better-sqlite3 database; WAL journal_mode, synchronous NORMAL, foreign_keys ON, busy_timeout 5000 ms.
- **Migrations (M03-1):** versioned `db/migrations/*.sql`, applied exactly once per transaction, SHA-256 checksums recorded in `schema_migrations`; forward-only (rollback = restore from backup).
- **Seeding:** deterministic conversation fixtures when the database is empty.
- **Path overrides:** `CALLFORGE_DB_PATH` / `CALLFORGE_DB_DIR`; default `data/callforge.db`.
- **Toolchain constraint:** package.json `engines.node >=24.0.0`; better-sqlite3 native binding verified incompatible with Node v22 (`ERR_DLOPEN_FAILED`); functional on Node 24. This cycle the canonical scratch path `/root/.hermes/cache/scratch/node24/bin` was absent (same as cycle 40); `/usr/local/bin/mrnothing-node` v24.22.1 was used and verified functional.

## 4. Evaluation

| Dimension            | SQLite (current baseline)                                         | PostgreSQL                                                                                                        |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Operations           | Zero-service embedded file; backups via file copy / `VACUUM INTO` | Dedicated instance; backups, pooling, patching, monitoring                                                        |
| Concurrency          | Single writer; file locks; `busy_timeout` handles contention      | Multi-writer; MVCC; client/server                                                                                 |
| Data residency (UAE) | Single local file; location directly controllable                 | Hosting location must be validated against UAE requirements (EXT-002/EXT-004)                                     |
| Simulation fit       | Sufficient for single-node dev console + stdio MCP baseline       | Over-engineered for the simulation baseline                                                                       |
| Migration path       | N/A (incumbent)                                                   | Requires a dedicated migration milestone, export/import, dual-run validation, and re-verified migration checksums |

## 5. Decision

**Retain SQLite as the system of record for the simulation baseline.** PostgreSQL is recorded as a pre-migration design evaluation (D-006); there is no migration commitment.

If migration is ever pursued, it requires: new dedicated branch + draft PR; owner approval via EXT-004; re-verification of the vitest suite, migration checksums, and backup/restore procedures; independent review; owner merge authorization. No direct protected-branch merges (D-002).

## 6. Gates unchanged

This deliverable does not open M05 (telephony), M06 (voice), or M09 (remote MCP) live paths. EXT-002 (qualified UAE legal/privacy review) and EXT-004 (production hosting + deployment approval) remain owner-gated. No live telephone calls, customer billing, production deployment, public plugin publication, protected-branch merge, or real customer data processing is authorized by this document.

# TECH-004 — Postgres vs SQLite decision record (M03 design deliverable)

Status: **PROPOSED** (dispatcher cycle 215, 2026-11-27). Awaiting independent review; no
migration is authorised by this document.
Owner-gated prerequisites: EXT-004 (production hosting) fixes the actual provider, and
EXT-002/EXT-003 fix the residency and carrier constraints that dominate the answer.
Upstream: D-006 (`management/ASCENSION_DECISIONS.md`) — "SQLite remains the system of record
for the simulation baseline; PostgreSQL evaluation is an M03 design deliverable before any
migration commitment."

## 1. Scope and what is actually being decided

Two questions are conflated in the ledger. Only the second is ours:

- **Q1 (owner-gated, not answerable here):** which managed database product, in which
  jurisdiction, under which contract. Requires EXT-004 plus the UAE privacy position; a
  provider choice without a hosting decision would be fiction.
- **Q2 (this document):** does the _engine_ stay embedded SQLite, move to PostgreSQL, or
  abstain behind a dialect layer; and what does each cost at current code shape?

The recommendation in §6 is deliberately conditional on Q1 rather than pretending Q1 is
resolved.

## 2. Measured current coupling

Counted on `origin/main` @ `28c9040`, excluding `node_modules` and tests. These are the
numbers that make this a port project rather than a driver swap.

| Signal                                               | Count                                                                               | Consequence for a port                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `prepare()` call sites in production code            | 87                                                                                  | every one becomes `await`-shaped with a pool client, or gets rewritten                                       |
| `db.transaction(fn)` uses                            | 5 production, 1 in a test fixture                                                   | sync callback → explicit `BEGIN/COMMIT` on a checked-out client, plus release-on-throw                       |
| `datetime('now')` occurrences                        | 45 (27 JS, 18 SQL)                                                                  | `now()` / `CURRENT_TIMESTAMP` rewrite, with timezone semantics changing (SQLite UTC text vs `timestamptz`)   |
| `INSERT OR IGNORE`                                   | 2 (`workflow/webhookInbox.mjs:19`, `:66`) + 1 fixture seed                          | `ON CONFLICT DO NOTHING`; webhook dedup semantics are load-bearing                                           |
| `rowid`-ordered reads that matter for correctness    | 4 (`audit.mjs:17`, `audit.mjs:93`, `audit.mjs:98`, `workflow/stateMachine.mjs:119`) | **hard** — see §3.1                                                                                          |
| `PRAGMA` calls                                       | 4 (`store.mjs:49-52`: WAL, synchronous, foreign_keys, busy_timeout)                 | drop WAL/synchronous, keep FK-as-default, replace busy_timeout with lock timeouts                            |
| `VACUUM INTO` + `PRAGMA integrity_check` backup path | all of `scripts/backup.mjs`                                                         | `pg_dump`/`pg_basebackup` + provider snapshot; the offline-restore contract changes                          |
| Schema `STRICT` tables                               | 0                                                                                   | no type enforcement to rely on in either engine; JSON lives in `TEXT` columns (`payload`, `turns`, `scopes`) |
| Primary-key shape                                    | 13 single-column `TEXT` UUIDv4 PKs (both composite PKs are `(tenant_id, resource)`) | random PKs, so insertion order is _only_ recoverable via `rowid`/a sequence — no natural sort key exists     |

Engine shape that the port breaks: `better-sqlite3` is **synchronous** (`store.mjs:42-55`,
`audit.mjs:13-24`, `workflow/dispatcher.mjs:30-55`). Postgres drivers are async-only. The
audit append path, the outbox claim/ack path and the migration runner all lean on synchronous
completion inside a transaction; `db.changes` (`workflow/dispatcher.mjs:42`,
`workflow/quota.mjs:144-145`) becomes `rowCount`+`RETURNING`. `appendQueue` in `audit.mjs:11`
already serialises appends in-process, which is exactly the assumption a second writer process
invalidates.

## 3. Where the engine difference is semantic, not syntactic

### 3.1 The hash chain rests on insertion order

`audit.mjs` orders by `rowid` on both the head read and verification, and `verifyChain`
takes a `rowid >=` range. Postgres has no user-visible `rowid`; `ctid` is unstable across
`UPDATE`/`VACUUM`. Because all PKs are UUIDv4, `ORDER BY id` is not insertion order and
`ORDER BY created_at` collides inside a millisecond — issue #4 was fixed with `rowid` for
precisely that reason. A port **must** add a monotonic `BIGINT GENERATED ALWAYS AS IDENTITY`
column to `audit_events` (and to `outbox`/`webhook_inbox` if dedup ordering is ever asserted)
and re-point the four queries at it. That column is then part of the tamper-evident contract
and must be included in the check or explicitly excluded by documentation.

### 3.2 Archival/checkpoint interaction (issue #190, in flight on PR #189)

PR #189 makes a truncated head report `anchored: false` instead of a false "chain broken".
On Postgres the same pressure returns immediately under any partitioning-by-time strategy:
a partition drop is a head truncation. Option 2 in #190 (signed per-batch checkpoint) is the
only variant that survives on either engine, and is cheaper to build once than twice.

### 3.3 Single-writer assumptions

`workflow/dispatcher.mjs` polls on a timer and `workflow/outbox.mjs` claims leases with
`UPDATE ... WHERE lease` semantics. That is correct on SQLite only because there is exactly
one writer process; on Postgres it becomes a genuine multi-worker claim problem that needs
`SELECT ... FOR UPDATE SKIP LOCKED` and a re-review of TECH-005's two-cycle proof. That is
the single largest review surface a port opens, and it touches the freshest code we have.

## 4. Options

### A — Stay on SQLite (WAL, one node, file volume)

- Cost: ~0 today. Suite is 256/256 with #193 merged; crash recovery is freshly proven (#194).
- Ceiling: one writer, one host. Backup is `VACUUM INTO` + integrity check, which is
  genuinely good for a single file but not point-in-time.
- Fails when: a second app instance must run concurrently for availability, or retention
  archival begins (#190's deferred half).
- Residency: trivially "wherever the volume is" — helpful under an unresolved UAE position.

### B — Port to PostgreSQL

- Buys: concurrent writers, `SKIP LOCKED` claims, streaming replication/PITR, per-tenant RLS
  as a second isolation layer behind SEC-001, and a real answer to archival partitioning.
- Costs: the 87/6/47 rewrite above, the identity-column schema change, an async conversion of
  audit and dispatcher, a rewritten backup/restore and its drill, and a full re-run of the
  concurrency proof we just finished. Optimistically 3–5 focused sessions for the mechanical
  port plus 2–3 for claim/concurrency re-review; realistically more once tests are ported.
- Risk: the port lands against code nobody has merged yet (#189, #191–#194 all touch these
  modules), so a naive branch would be stale on arrival. It should be cut _after_ the current
  merge queue drains.

### C — Abstention layer now, port later

A thin DB facade (async, pooled) that both drivers implement, with the SQL held to a shared
subset. Attractive, and the natural first step of B — but it costs most of B's churn
immediately (every call site changes) while buying nothing until a second driver exists. Only
worth it if B is certain; as a hedge it is the worst of both.

- Verdict: **do not adopt as a standalone option**; take it only as the first commit of B.

## 5. Criteria against the actual programme

| Criterion                            | Weight                    | A (SQLite)                | B (Postgres)                      | C (facade)   |
| ------------------------------------ | ------------------------- | ------------------------- | --------------------------------- | ------------ |
| Works before EXT-004                 | high                      | yes                       | yes, locally                      | yes          |
| Concurrency / multi-instance         | high, but only at M11–M12 | no                        | yes                               | no (until B) |
| Audit chain preserved                | critical                  | yes, as-is                | needs identity column + re-review | n/a          |
| Backup/PITR to a reviewable standard | high                      | single-file snapshot only | yes                               | no           |
| UAE residency flexibility            | medium                    | yes                       | depends on host                   | n/a          |
| Churn on unmerged work               | high right now            | none                      | high                              | highest      |
| Test/CI speed                        | medium                    | fast, in-process          | container service in CI           | same as B    |
| Team-shaped risk                     | medium                    | low                       | medium-high                       | high         |
| Cost to reach M06 (live voice)       | medium                    | low                       | medium                            | medium       |

## 6. Recommendation

1. **Keep SQLite as the system of record through M06/M09 single-node work.** Nothing in the
   live-voice milestones needs a second concurrent writer, and #190 stays latent while
   `audit_events` is retention-protected.
2. **Treat PostgreSQL as the committed target for the point where availability, not features,
   forces it** — first second-instance requirement, first archival requirement that breaks the
   head anchor, or EXT-004 naming a managed host. Decide B there, on the then-current `main`,
   not on today's tree.
3. **Do not build the facade (C) first.**
4. Hedge cheaply in the meantime, all of which is useful even if we never port:
   - land #189 (it already makes `anchored` explicit) and finish #190 option 2 as a signed
     checkpoint, so head-truncation is verifiable rather than merely reported — engine-neutral;
   - add the monotonic `seq` column on `audit_events` and order by it instead of `rowid`
     _now_; that removes the single hardest porting hazard and is a no-op semantically on
     SQLite;
   - keep `prepare()` call sites free of SQLite-only syntax where the Postgres equivalent is
     equally terse, and keep all SQL in the module that owns the table (mostly already true);
   - record the backup/restore drill result on the current engine so the Postgres drill has a
     baseline to beat.

## 7. Explicitly not decided here

- Product/vendor, region, tier and cost — EXT-004.
- Whether tenant isolation moves from application predicates to RLS policies — depends on
  SEC-001's IdP outcome; RLS is a _complement_ to verified identity, not a substitute.
- Partitioning and retention windows — needs the UAE legal position (EXT-002).
- Any migration schedule that implies a cut-over date.

## 8. Acceptance criteria for this record

Reviewable when: the coupling counts in §2 reproduce, §3.1 is agreed as a real blocker rather
than noise, and the reviewer either accepts §6 or names the criterion that should promote B.
This document changes no source, schema, test or dependency; CI on the docs branch is the
only executable evidence.

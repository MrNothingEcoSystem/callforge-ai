# TECH-004 decision record — independent read-only review

- Target: PR **#195**, head **`cca967c601747062bb5443f48689333ad7826f80`**, base `main`
  @ `28c9040`.
- Method: detached worktree at the head (`git worktree add --detach`, Node 24 toolchain),
  re-counted every §2 signal, read the full diff for scope.
- Scope check: 5 files, all `management/` — no source, schema, test, dependency or
  enforcement change. Confirmed: the diff cannot change runtime behaviour.

## Reproduction of the record's numbers

| Claim                             | Recomputed                                       | Match |
| --------------------------------- | ------------------------------------------------ | ----- |
| `prepare()` sites, production     | 87                                               | yes   |
| `db.transaction` uses, production | 5 (doc: "5 production, 1 in a test fixture")     | yes   |
| `datetime('now')` total           | 45                                               | yes   |
| `INSERT OR IGNORE`, production    | 3 including the fixture seed (doc: "2 + 1 seed") | yes   |
| `rowid` reads, production         | 4                                                | yes   |
| `STRICT` tables                   | 0                                                | yes   |
| `PRAGMA` calls in `store.mjs`     | 4                                                | yes   |
| Single-column UUIDv4 PKs          | 13, plus 2 composite `(tenant_id, resource)`     | yes   |

Spot-checked anchors: `audit.mjs:17,93,98` and `workflow/stateMachine.mjs:119` really do
order by `rowid`; `workflow/webhookInbox.mjs:19,66` really are `INSERT OR IGNORE` dedup
paths; `scripts/backup.mjs` really is `VACUUM INTO` + `PRAGMA integrity_check`;
`RETENTION_PROTECTED` really does still contain `audit_events` (so §6.1's "stays latent" holds);
issue #190 really does offer option 2 as a signed checkpoint. §3.1's core argument — no
portable ordering key — is correct given UUIDv4 PKs.

## Verdict

**ACCEPT**, with three Info notes. The record answers Q2 (engine) without pretending to
answer Q1 (product/region, EXT-004/EXT-002), which is the failure mode of most such
documents. The recommendation is conditional on named triggers rather than a date, and the
rejected option (facade-first) is rejected with a reason. Nothing here authorises a port,
which matches D-002/D-006.

## Info notes

- **I1:** the §6.4 hedge is not free — an `audit_events.seq` column is itself a migration and
  a `audit.mjs` change. It should be its own PR paired with #190 option 2, not folded into the
  checkpoint work silently.
- **I2:** the "3–5 focused sessions + 2–3" estimate in §4/B is judgement, not measurement, and
  is not marked as such. Leave it as an order-of-magnitude, not a commitment.
- **I3:** §2 counts are a snapshot of `28c9040`; §8 asks a reviewer to reproduce them, so any
  later reader must re-base before trusting them. Recorded here so drift is traceable.

No blocking finding. CI `verify` SUCCESS at this head (run 45931246381). No merge, deploy,
live call or spend.

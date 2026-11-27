# TECH-014 review — revision retention/pruning (PR #210)

- Date: 2026-11-27, cycle 235
- Branch `tech-014-revision-retention`, head `845ce74`, stacked on `tech-014-policy-lww` (#209)
- Reviewer: cycle-run probe, **not** a delegated independent auditor (labelled as such)

## Change

`recordPolicyRevision` deletes, in the caller's transaction and after the insert, every
`tenant_policy_revisions` row older than the newest `POLICY_REVISION_RETENTION` (250) for that
tenant. Bounded above `HISTORY_LIMIT_MAX` (200) so a maximal page is always satisfiable.

## Verdict: ACCEPT

Probe (`data/probe-retention`, thrown away afterwards), 300 writes for tenant A, 1 for tenant B:

```
{"retention":250,"tenantA":{"n":250,"lo":51,"hi":300},"tenantB":{"n":1},
 "rowsTotal":251,"pageLen":200,"newestPolicy":{"n":299},"oldestInPage":{"n":100}}
```

- 300 → exactly 250 kept, the newest 250 (`lo` 51 = `hi` 300 − 249), oldest 50 dropped.
- Tenant B untouched at 1 row: pruning is per tenant, and total rows stay at A's bound + B.
- A 200-entry page still returns 200 entries, newest (n=299) to n=100, so retention does not cap
  the read surface.
- Mutation check: removing the `DELETE` fails 3 of the 5 new tests (`keeps the newest…`,
  `bounds each tenant independently`, `prunes on an accepted API write too`).
- A rejected (400) write prunes nothing — it never reaches the insert.

## Follow-ups (non-blocking)

- F1: retention is a fixed count, not an age. A tenant with sparse edits keeps years of rows;
  an age bound (e.g. 24 months, pending EXT-002 counsel because it is evidence) is the eventual
  shape.
- F2: pruning is synchronous in the write transaction. At 250 rows the delete is sub-millisecond,
  but if retention grows into the thousands this belongs in a periodic sweep.
- F3: dropped rows are not summarised, so history visibly starts mid-stream with no marker. A
  `retention_trimmed` audit event or a `truncated: true` flag on a full page would say so.

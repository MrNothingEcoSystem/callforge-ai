# Review — `DELETE /tenant/policy` revert (cycle 231, PR #207)

Read-only worktree probe staged by the cycle runner at two revisions, in detached worktrees
with the main checkout's `node_modules` symlinked and a throwaway database:

- pre-fix `23fb1af` (PR #206 head) — the control
- fixed `9cd4d3a` (PR #207 head)

Each probe: store a valid 07:00–18:00 override, then `DELETE /tenant/policy`, then `GET`.

| revision | PUT | DELETE                                                             | tenant after DELETE         |
| -------- | --- | ------------------------------------------------------------------ | --------------------------- |
| 23fb1af  | 200 | **400** `Invalid tenant policy` (empty body parsed as `{}`)        | still `tenant`, still 07:00 |
| 9cd4d3a  | 200 | **200** `{reverted:true, source:"default"}`, removed policy echoed | `default`, 09:00            |

The control shows the defect is real and pre-existing, not a test artefact: before the fix a
revert attempt lands in the PUT body path and fails validation, leaving the override in force.
The fix routes DELETE before the body read and returns the tenant to the statutory window.

## Verdict: ACCEPT

Findings, none blocking:

- **F1 (residual, by design).** No history table, so the previous policy survives only as the
  audit payload. A revert followed by a decision made months earlier in the audit log is
  reconstructable but not queryable. Named as the next task.
- **F2.** `tenant_policy_reverted` writes `reverted_policy: null` plus violations for a
  constraint-legal but invalid row; a reader that assumes the field is an object must handle
  null. Covered by a test.
- **F3.** The revert is not guarded against a concurrent PUT: PUT-then-DELETE races resolve
  last-write-wins. Same class as the recorded last-write-wins item, not newly introduced.

Not a delegated external auditor — a cycle-run probe, labelled as such, as with F3/F5/F6.

# CALLFORGE OMEGA — Dependency-Safe Merge Sequence

Date: 2026-11-09. Status: planned, **NOT authorized to merge** — this file
is the plan only. Each step requires its acceptance gate + explicit owner
authorization. No protected-branch merges without approval.

## Current PR graph (2026-11-09)

| PR                  | Branch → main                    | Head      | Gate status                                                                                     |
| ------------------- | -------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| #7 M02 identity     | `m02-oauth-tenant-isolation`     | `4368955` | Audit ACCEPT WITH FOLLOW-UPS; CI PASS; SEC-001 blocks production identity, not simulation merge |
| #9 M03-1 durability | `m03-durable-workflow`           | `d8f7df0` | Re-review in flight                                                                             |
| #11 docs            | `docs/ascension-supervisor-sync` | `0f54842` | CI PASS                                                                                         |
| Orphan              | `docs/ascension-cycle-001`       | `f2cfdd5` | No PR; content superseded by #11 — **do not delete** (unauthorized)                             |

## Dependency analysis

- #9 (M03-1) is based on pre-M02 main: `store.mjs`/`server.mjs` overlap with
  #7. Merging #7 first invalidates #9's base → #9 must be rebased and
  re-tested (expect conflicts in `server.mjs` simulate handlers and
  `store.mjs` init path), then re-reviewed at the new head.
- #11 is docs-only under `management/` → mergeable in any order, but
  merge it before #7/#9 so the ledger records the merge commits as they land.
- M03-2 (planned) rebases onto merged M02+M03-1.

## Proposed sequence (each step gated)

1. **PR #11 (docs)** — owner merge authorization. Records all verdicts.
2. **PR #7 (M02)** — owner merge authorization. After merge: close issue #1
   (simulation scope), keep SEC-001 open as production blocker.
3. **Rebase PR #9** onto new main → resolve `server.mjs`/`store.mjs`
   conflicts (M02 guard calls in simulate handlers; migration runner) →
   full gates + independent re-review at the new exact head.
4. **PR #9 (M03-1)** — owner merge authorization after re-review ACCEPT.
5. **M03-2 branch** from merged main; webhook wiring lands here (needs M02
   guard) per `management/M03_2_PLAN.md`.

## Rollback

- Each merge is a single merge commit; revert = `git revert` of that commit
  (forward-only migration policy means data rollback is restore-from-backup,
  see `scripts/backup.mjs`).
- No force-pushes at any step.

## Authorization checklist (owner)

- [ ] PR #11 merge
- [ ] PR #7 merge (simulation baseline; SEC-001 remains open)
- [ ] PR #9 merge (only after rebase + re-review at new head)

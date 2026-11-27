# TECH-014 — policy history route, read-only probe record

- Date: 2026-11-27, cycle 232
- Subject: `ef3047c` on `tech-014-policy-history`, draft PR #208 (stacked on #207)
- Method: cycle-run worktree probe, **not** a delegated external auditor. Two detached
  worktrees of the same repo — control `10ccbaf` (parent) and fix `ef3047c` — each booted
  with its own SQLite file on its own port, driven by the same scripted HTTP session:
  authorize → PUT policy → `GET /tenant/policy/history` → DELETE → history again, plus an
  unauthenticated history read and a POST to the path.

## Observed

| Step | Control `10ccbaf` | Fix `ef3047c` |
| --- | --- | --- |
| `PUT /tenant/policy` | **500** `CHECK constraint failed: actor_type` | 200, policy stored |
| `GET /tenant/policy/history` | **404** (no route) | 200, one `updated` entry with the applied policy |
| `DELETE /tenant/policy` | **500** same CHECK | 200, revert reported |
| history after revert | 404 | 200, `reverted` then `updated`, newest-first, row gone |
| POST to history path | 404 | 404 |
| history without a token | 404 | 401 |

## Verdict

**ACCEPT.** The route does what it claims and the revert history survives the row deletion
it describes.

## Findings

- **F1 (fixed in-cycle, the significant one).** Every `PUT` and `DELETE /tenant/policy`
  answered 500 on a real server: the audit entry used `actor_type: 'client'`, which
  `audit_events` CHECK-rejects (`system|user|agent|provider`). Handler tests stub
  `auditLogger`, so CI has been green on a broken write surface since PR #201. Changed to
  `'user'`; new test asserts both audit entries use an allowed value. The stack still
  carries the break until #208 — an owner who merges #201..#207 without #208 ships it.
- **F2 (open, low).** Revisions are never pruned. Growth is one row per policy change, so
  it is slow, but there is no retention policy or cap for a long-lived tenant.
- **F3 (open, low).** `created_at` has one-second granularity; ordering within a second
  relies on `id`. Correct today because `id` is the sort key; a future "as of" reader must
  use it, not the timestamp.
- **F4 (by design).** History rows `ON DELETE CASCADE` from `tenants`; deleting a tenant
  discards its policy history.
- **F5 (by design).** `limit` only, no cursor. Bounded at 200 with a 50 default; a cursor
  can wait until a dashboard exists (EXT-002).
- **F6 (scope).** The history is the tenant's own; there is no cross-tenant or owner-wide
  view, matching the rest of the policy surface.

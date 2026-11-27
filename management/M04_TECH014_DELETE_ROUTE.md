# TECH-014 follow-up (review #197 F3): `DELETE /tenant/policy` revert

Cycle 231. Branch `tech-014-delete-policy-route`, stacked on `tech-015-f6-bounded-sim-log`
(PR #206). Draft PR only; no merge, no deploy, no live call.

## Problem

`PUT /tenant/policy` could set a tenant override but nothing could take it away, so a
tenant that had once stored a policy could never get back to the statutory defaults
without a database operator. The gate then ran on the last accepted override forever.

## Shape

- `DELETE /tenant/policy`, `admin` scope (the read stays on `read`), tenant from the
  token only — no body, and therefore no `tenant_id` mismatch path.
- `deleteTenantPolicy()` reads the row with the same validator before deleting it, so the
  audit record carries `reverted_policy` **and** `violations`. A corrupt row (constraint-
  legal but failing validation, e.g. an inverted 18–7 window) is reported in the audit
  payload with `reverted_policy: null` rather than disappearing unreported.
- Removing the row restores "absent row = statutory defaults", so the next dial evaluates
  on defaults again. There is no history table: the previous policy survives only in the
  audit log — that is the deliberate last-write-wins position until the history route.
- Idempotent: no row means the tenant is already at the defaults, so the response is a
  200 with `reverted: false` and nothing is audited. A repeated DELETE is safe.
- Audited as `tenant_policy_reverted` / `delete_tenant_policy`, only on an actual delete.

## Verification

8 new tests (18 in the file, 242/242 whole suite), `tsc --noEmit`, `eslint`, `prettier`
clean. Tests cover: unauthenticated 401, operator 403 with the row intact, real revert
followed by a 200/`default` read, idempotent no-op without an audit entry, audit payload
carries the removed policy, cross-tenant isolation, corrupt-row reporting, and the helper
contract.

## Left open

The `GET /tenant/policy` history route (needs a revisions table), and last-write-wins on
concurrent PUTs. M04 closure still needs EXT-002; nothing here places a live call.

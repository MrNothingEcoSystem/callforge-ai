# TECH-014 — tenant policy read/write surface

Closes review follow-up **F3** of `TECH013_REVIEW_RECORD.md`. TECH-013 gave the pre-dial gate a
per-tenant policy record but nothing could write it except a DB operator.

## Contract

| Route                | Scope   | Behaviour                                                                                           |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `GET /tenant/policy` | `read`  | `200` with `source: 'tenant'`/`'default'`; **`409`** + `policy: null` if the stored row is unusable |
| `PUT /tenant/policy` | `admin` | Validates first, then upserts; `400` + `violations` on rejection (stored row untouched)             |

- Tenant identity comes from the token. A body `tenant_id` may agree with it; anything else is `403`
  (`rejectTenantMismatch`), so the surface cannot be used to write another tenant's policy.
- `409` on read is deliberate: an unusable row must not be laundered into the statutory defaults by
  a proxy that only looks at `policy`.
- Accepted writes are audited as `tenant_policy_updated` with the applied policy; the audit chain
  therefore records every threshold change with actor and tenant.
- Body may be the policy object itself or `{ policy: {...} }`; malformed JSON is `400`.
- No schema change and no new dependency; `PUT` added to CORS.

## Boundaries (deliberate)

Still simulation-mode administration: no human approval step on a policy change (that is M04
closure / EXT-002), no dashboard, no revision history beyond the audit chain. These are recorded
follow-ups, not defects.

## Open follow-ups

1. No list/delete routes (delete = revert to statutory defaults).
2. Last-write-wins on concurrent PUTs from two admins (same class as #196 F4).
3. In-flight `dial_requests` keep the snapshot taken at request time; a later policy change does not
   re-evaluate them — intended, but should be asserted explicitly at M05 when the sink lands.

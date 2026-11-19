# CALLFORGE OMEGA — Ascension Blockers

## External gates (owner authorization required)

| ID      | Gate                                                 | Blocks                     |
| ------- | ---------------------------------------------------- | -------------------------- |
| EXT-001 | SRC-001: original v0.2 source bundle missing         | source-equivalence claims  |
| EXT-002 | Qualified UAE legal/privacy review                   | M04 closure, public claims |
| EXT-003 | Authorized UAE telephony provider + carrier contract | M05 live activation        |
| EXT-004 | Production hosting + deployment approval             | M12 release                |
| EXT-005 | Paid voice API credentials (ASR/TTS)                 | M06 live benchmarks        |
| EXT-006 | CRM OAuth app registrations                          | M07 connectors             |
| EXT-007 | Billing provider approval                            | M10 real charging          |
| EXT-008 | OpenAI publisher verification + domain ownership     | M15 submission             |
| EXT-009 | Final publication approval                           | M16                        |

## Technical blockers

| ID       | Blocker                                           | Status                           | Next action                                     |
| -------- | ------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| TECH-001 | M02 PR #7 independent security verdict pending    | In progress (auditor dispatched) | Record verdict; fix blocking findings on branch |
| TECH-002 | Issues #2, #4, #5, #6 open follow-ups             | Open                             | Schedule into M02/M03 branches                  |
| TECH-003 | No durable workflow layer yet                     | M03 design dispatched            | Implement increment 1                           |
| TECH-004 | Postgres vs SQLite decision                       | M03 evaluation                   | Design deliverable                              |
| TECH-005 | CALLFORGE dispatcher not yet proven over 2 cycles | Pending                          | Run + verify recovery                           |

Engineering continues on independent work whenever a gate is blocked.

## Cycle 1 security audit (2026-11-09, PR #7 head ac0adcb)

| ID      | Finding                                                                                                                                                                                                                                    | Severity                                                                         | Status                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | `/oauth/authorize` is unauthenticated: any caller can supply any `tenant_id` + `tenant_admin` role and receive a valid token (verified locally). Tenant isolation is therefore self-asserted, not verified.                                | Critical for production; acceptable only if M02 is relabeled simulation baseline | Open — blocks M02 acceptance as "production identity"; blocks any external deployment                                                                                              |
| SEC-002 | `tokenSecret()` falls back to hardcoded `callforge-dev-secret-change-me` when `CALLFORGE_TOKEN_SECRET` is unset; tokens are forgeable in any deployment that omits the env var.                                                            | Critical for production                                                          | **Fixed in `65ff410`** — fail closed without env secret; regression test added                                                                                                     |
| SEC-003 | Non-blocking: PKCE comparison is not timing-safe; used codes are retained (marked used, not deleted); token handler trusts in-token `scope` without re-deriving from `role`; conversation fixtures are not tenant-scoped (assumed global). | Low                                                                              | **Partially fixed in `65ff410`** — timing-safe compare + code invalidation on failed PKCE + unauthenticated-conversation test; scope re-derivation and fixture scoping remain open |

Local verification this cycle: Node v24.22.2, pnpm 12.18.0, `pnpm test` on PR #7 worktree = 10 files, 70/70 passed. CI `verify` pass (run 42559869614). Signature tampering correctly rejected; the flaw is issuance, not verification.

## Cycle 74 — PR #65 rework (2026-11-19, head 7ce247f (prettier fix 7ce247f); 7d8671f first cut)

Reworked PR #65 per Cycle 73 verdict. F-65-3 (role escalation) and F-65-5 (no HTTP-level tests) fixed on branch m02-oauth-tenant-isolation:

- `handleOAuthAuthorize` (server.mjs): role pinned to `authContext.role`; `body.role` differing from token role → 403; token with no role → 403; requested scope intersected with token scopes, empty intersection → 403.
- 5 new HTTP-level tests in tests/m02-oauth.test.mjs (real HTTP server): unauthenticated 401, cross-tenant 403, role-escalation 403, pinned-role happy path (authorize→exchange→validate role/scope), scope-widening 403.
- Local: 78/78 tests pass (was 73/73). Live probe: operator token + body.role=tenant_admin → 403 (was 200 in cycle 73); operator + role=operator → 200 with code.
- F-65-4 (bootstrap circularity) remains OPEN by design of this simulation baseline: the only token-issuance path is /oauth/token which requires a code from /oauth/authorize, and authorize now requires a Bearer token. A documented bootstrap path requires an owner decision (e.g. a separate dev-token issuer, or a real IdP) before SEC-001 can be fully closed.
- SEC-001 status: tenant binding + role pinning + scope narrowing fixed and tested; bootstrap remains an open design decision.


## Cycle 75 — PR #65 independent re-review verdict (2026-11-19, head 7ce247f)

Adversarial re-audit (read-only worktree of origin/m02-oauth-tenant-isolation at 7ce247f; Node v24.15.0, pnpm 12.18.0):

- `pnpm test` = 78/78, 10 files, pass. CI verify SUCCESS at 7ce247f.
- Independent live HTTP probes (fresh server, operator token for tenant-A):
  - role=tenant_admin + scope [admin, audit] → 403 "Role mismatch: role is derived from the access token" (cycle-73 role-escalation finding CLOSED)
  - role=operator + scope [read] → 200 with code (pinned-role happy path)
  - tenant_id=tenant-B → 403 "Tenant mismatch: token tenant does not match request tenant"
  - unauthenticated → 401 "Missing or invalid Authorization header"
- Verdict: **ACCEPT WITH FOLLOW-UPS**. F-65-3 and F-65-5 fixed and verified. F-65-4 (bootstrap circularity) remains OPEN by design: the only issuance path is /oauth/authorize, which now requires a Bearer token; a documented bootstrap path needs an owner decision (dev-token issuer or real IdP) before SEC-001 can be fully closed. Verdict posted as comment on PR #65 (no merge).

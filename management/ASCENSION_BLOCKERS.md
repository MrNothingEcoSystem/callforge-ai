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

| ID       | Blocker                                                                                    | Status                                                                                        | Next action                                                                 |
| -------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TECH-001 | M02 PR #7 independent security verdict pending                                             | In progress (auditor dispatched)                                                              | Record verdict; fix blocking findings on branch                             |
| TECH-002 | Issues #2, #4, #5, #6 open follow-ups                                                      | Fixes done on PR #189, review ACCEPT WITH FOLLOW-UPS                                          | Owner merge decision; close on merge                                        |
| TECH-006 | Audit archival breaks full-chain verify (issue #190)                                       | **Addressed on PR #189** (unanchored-head reporting)                                          | Review; signed checkpoints stay owner-policy                                |
| TECH-007 | MCP tool surface self-asserted tenant + stub `requireScopes()` (issue #8)                  | Addressed on `mcp-tool-tenant-auth` (PR #191, review ACCEPT WITH FOLLOW-UPS)                  | Owner merge                                                                 |
| TECH-008 | No remote transport for the MCP surface (M09)                                              | Step 1 done on PR #192 (opt-in Streamable HTTP, review ACCEPT WITH FOLLOW-UPS, F1/F2 fixed)      | Owner merge; then discovery/audience, rate limits, annotations, elicitation |
| TECH-009 | Pre-existing `better-sqlite3` 11.10 worker SIGABRT aborts ~2 workers per parallel test run | Open, reproduces on main; CI remains green because the failing workers carry no test failures | Decide: `isolate:false`, upgrade better-sqlite3, or pin vitest pool         |
| TECH-003 | No durable workflow layer yet                                                              | M03 design dispatched                                                                         | Implement increment 1                                                       |
| TECH-004 | Postgres vs SQLite decision                                                                | M03 evaluation                                                                                | Design deliverable                                                          |
| TECH-005 | CALLFORGE dispatcher not yet proven over 2 cycles                                          | Pending                                                                                       | Run + verify recovery                                                       |

Engineering continues on independent work whenever a gate is blocked.

## Cycle 1 security audit (2026-11-09, PR #7 head ac0adcb)

| ID      | Finding                                                                                                                                                                                                                                    | Severity                                                                         | Status                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | `/oauth/authorize` is unauthenticated: any caller can supply any `tenant_id` + `tenant_admin` role and receive a valid token (verified locally). Tenant isolation is therefore self-asserted, not verified.                                | Critical for production; acceptable only if M02 is relabeled simulation baseline | Open — blocks M02 acceptance as "production identity"; blocks any external deployment                                                                                                   |
| SEC-002 | `tokenSecret()` falls back to hardcoded `callforge-dev-secret-change-me` when `CALLFORGE_TOKEN_SECRET` is unset; tokens are forgeable in any deployment that omits the env var.                                                            | Critical for production                                                          | **Fixed in `65ff410`** — fail closed without env secret; regression test added                                                                                                          |
| SEC-003 | Non-blocking: PKCE comparison is not timing-safe; used codes are retained (marked used, not deleted); token handler trusts in-token `scope` without re-deriving from `role`; conversation fixtures are not tenant-scoped (assumed global). | Low                                                                              | **Scope re-derivation fixed** in `validateAccessToken` (cycle 193); timing-safe compare + code invalidation in `65ff410`; conversation fixture scoping remains open (documented global) |

Local verification this cycle: Node v24.22.2, pnpm 12.18.0, `pnpm test` on PR #7 worktree = 10 files, 70/70 passed. CI `verify` pass (run 42559869614). Signature tampering correctly rejected; the flaw is issuance, not verification.

## Cycle 190 — cleanup PR #189 (issues #2/#4/#5/#6), head 97efda6

Draft PR #189 (branch cleanup/issues-2-4-5-6): verifyChain partial-verification fix, rowid ordering, node:crypto test imports, start() socket smoke test. Local 111/111 pass. Awaiting independent review + owner merge; issues remain open until merged.

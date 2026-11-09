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
| SEC-003 | Non-blocking: PKCE comparison is not timing-safe; used codes are retained (marked used, not deleted); token handler trusts in-token `scope` without re-deriving from `role`; conversation fixtures are not tenant-scoped (assumed global). | Low                                                                              | **Fixed in 65ff410 (timing-safe PKCE + code invalidation + auth test) + PR #31 (scope re-derivation, head 7e680a6, 111/111, mutation-verified, independent ACCEPT 2026-11-09 cycle 18, draft awaiting owner merge)**; fixture scoping remains open |

Local verification this cycle: Node v24.22.2, pnpm 12.18.0, `pnpm test` on PR #7 worktree = 10 files, 70/70 passed. CI `verify` pass (run 42559869614). Signature tampering correctly rejected; the flaw is issuance, not verification.

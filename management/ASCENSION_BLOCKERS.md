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
| TECH-002 | Issues #2, #4, #5, #6 M01 follow-ups | **Fixed in draft PR #14 (cycle 3, head d422921, CI PASS)** | Merge decision by owner; issues close on merge |
| TECH-003 | No durable workflow layer yet                     | M03 design dispatched            | Implement increment 1                           |
| TECH-004 | Postgres vs SQLite decision | **Evaluation filed management/TECH004_POSTGRES_EVALUATION.md (cycle 4); owner verdict pending** | Owner accepts recommendation (SQLite baseline; Postgres gate before multi-writer/live); portability follow-ups a–d scoped into M03-2 |
| TECH-005 | CALLFORGE dispatcher not yet proven over 2 cycles | Pending                          | Run + verify recovery                           |

Engineering continues on independent work whenever a gate is blocked.

## Cycle 1 security audit (2026-11-09, PR #7 head ac0adcb)

| ID      | Finding                                                                                                                                                                                                                                    | Severity                                                                         | Status                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | `/oauth/authorize` is unauthenticated: any caller can supply any `tenant_id` + `tenant_admin` role and receive a valid token (verified locally). Tenant isolation is therefore self-asserted, not verified.                                | Critical for production; acceptable only if M02 is relabeled simulation baseline | Open — blocks M02 acceptance as "production identity"; blocks any external deployment                                                                                              |
| SEC-002 | `tokenSecret()` falls back to hardcoded `callforge-dev-secret-change-me` when `CALLFORGE_TOKEN_SECRET` is unset; tokens are forgeable in any deployment that omits the env var.                                                            | Critical for production                                                          | **Fixed in `65ff410`** — fail closed without env secret; regression test added                                                                                                     |
| SEC-003 | Non-blocking: PKCE comparison is not timing-safe; used codes are retained (marked used, not deleted); token handler trusts in-token `scope` without re-deriving from `role`; conversation fixtures are not tenant-scoped (assumed global). | Low                                                                              | **Partially fixed in `65ff410`** — timing-safe compare + code invalidation on failed PKCE + unauthenticated-conversation test; scope re-derivation and fixture scoping remain open |

Local verification this cycle: Node v24.22.2, pnpm 12.18.0, `pnpm test` on PR #7 worktree = 10 files, 70/70 passed. CI `verify` pass (run 42559869614). Signature tampering correctly rejected; the flaw is issuance, not verification.

## M03-1 independent audit (2026-11-09 cycle 2, PR #9 head d8f7df0)

Verdict: ACCEPT WITH FOLLOW-UPS. Local: 68/68 tests, CI verify pass (run 42562805539). Verdict posted as PR #9 comment.

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| F-M03-01 | Webhook signature stored but never verified; receiveWebhook accepts null signature. Must verify at HTTP layer before live provider use. | Medium (pre-M05) | Open — M03-2/M05 |
| F-M03-02 | claimBatch/checkQuota/applyRetention/reconcile not wired into server routes yet (scaffolding only). | Low | Open — M03-2 |
| F-M03-03 | hashEventSync duplicates store.mjs canonicalization; drift risk. | Low | Open |
| F-M03-04 | checkQuota fails open when no quota row exists; confirm intended default. | Medium (billing) | Open |
| F-M03-05 | Chain-head read and single-writer claim are SQLite-specific; revisit under Postgres evaluation. | Low | Open — TECH-004 |

TECH-001 (M02 verdict): recorded cycle 1. TECH-003 (no durable workflow layer): M03-1 done, in review.

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

## Cycle 9 — PR #26 (M09 remote MCP) independent audit (2026-11-09, head 62973e1)

Verdict: NOT ACCEPTED as M09 milestone. Draft scaffolding increment only; do not merge as production M09.

Verified (read-only, isolated worktree, removed after):
- Tenant ONLY from token: adaptRemoteArgs rejects mismatched client tenant_id (403), deletes + re-injects token tenant; create_dev_token excluded from remote registry; tenant_id stripped from public schemas.
- Auth: unauthenticated /mcp -> 401 (tested); per-tool scopes checked via guard() second call; 1 MiB body limit -> 413; parse error -> 400.
- get_call_status query is tenant-scoped (id AND tenant_id); check_readiness functional.
- Tests: 114/114 passed (14 files, 5.33s), eslint clean, tsc clean, prettier clean; CI verify PASS (run 42582626341).

Blocking follow-ups before M09 merge:
- F-PR26-1 (functional): handleMcp callTool is a stub for 8/10 tools — returns {simulated:true} without dispatching the tool registry, without schema validation, and without quota consume/release. simulate_call via /mcp creates NO call intent, contradicting mcp.mjs header ("same simulated path as /simulate/*"). Either dispatch the real registry or return an explicit not-implemented JSON-RPC error; fake success is a correctness hazard for MCP clients.
- F-PR26-2 (tests): no tests for per-tool scope denial (e.g. read-only token -> simulate_call), get_call_status cross-tenant isolation, 413 body limit, or malformed JSON.
- F-PR26-3 (annotations): idempotentHint:true is advertised for simulate_call/simulate_conversation, which create intents — should be false until idempotency keys are wired.
- F-PR26-4 (robustness): no try/catch around callTool in createMcpHandler — a DB/registry throw leaves the request hanging (unhandled rejection).

Non-blocking: double guard() call per tools/call (authenticate runs twice; harmless, wasteful); PR #26 also touches root milestone-ledger.json + management/ASCENSION_MILESTONES.json, overlapping dispatcher PR #25 — expect a trivial conflict on merge.

SEC-001 remains the production-identity gate for M09 regardless of F-PR26 fixes.

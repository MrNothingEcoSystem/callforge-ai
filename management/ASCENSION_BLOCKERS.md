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

| ID       | Blocker                                           | Status                           | Next action                                         |
| -------- | ------------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| TECH-001 | M02 independent security verdict                  | Recorded (ACCEPT WITH FOLLOW-UPS); SEC-002/SEC-003 fixed in 65ff410 | SEC-001 open — owner IdP decision; record owner merge decision on PR #7 |
| TECH-002 | Issues #2, #4, #5, #6 open follow-ups             | Resolved — cleanup PR #51 (draft, `cleanup/m01-followups` @ `4c99e8c` → main); verifyChain predecessor seed fix, rowid ordering in getEvents, node:crypto imports in tests, start()/close smoke test; tests 13 files / 112/112 on Node v24.22.2 | Owner merge decision on PR #51 |
| TECH-003 | Durable workflow layer (M03-1)                    | Done — merged PR #9, ACCEPT      | None                                                |
| TECH-004 | Postgres vs SQLite decision                       | Resolved — SQLite/better-sqlite3, deferred Postgres with rationale | None |
| TECH-005 | Dispatcher proven over cycles                     | Multiple cycles executed (docs/ascension-cycle-001…030, gate checks green) | Unattended recovery not exercised this cycle |
| TECH-006 | Issue #8 MCP surface (remote /mcp endpoint)       | Implemented + verified — `m09-remote-mcp` @ `5785f0f`, draft PR #26 → main, 14 files / 122 tests passed on Node v24.22.2 | Owner merge decision on PR #26; M09 cannot close until M02/SEC-001 resolved |

## Cycle security audit (2026-11-09, M02 head 4368955)

| ID      | Finding                                                                                                                                                                                                                                    | Severity                                                                         | Status                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| SEC-001 | `/oauth/authorize` is unauthenticated: any caller can supply any `tenant_id` + `tenant_admin` role and receive a valid token. Tenant isolation is self-asserted, not verified.    | Critical for production; acceptable only if M02 is relabeled simulation baseline | Open — blocks M02 production-identity acceptance; blocks external deployment; owner IdP decision needed |
| SEC-002 | `tokenSecret()` fell back to hardcoded `callforge-dev-secret-change-me` when `CALLFORGE_TOKEN_SECRET` unset; tokens forgeable.                                                | Critical for production                                                          | Fixed in `65ff410` — fail closed without env secret; regression test added                              |
| SEC-003 | PKCE compare not timing-safe; used codes retained (marked, not deleted); token handler trusts in-token `scope`; conversation fixtures not tenant-scoped.                         | Low                                                                              | Partially fixed in `65ff410` — timing-safe compare + code invalidation on failed PKCE; scope re-derivation and fixture scoping remain open |

Local verification this cycle: Node v24.22.2, vitest — 14 files, 122/122 passed against `m09-remote-mcp` @ `5785f0f` (issue #8 MCP surface, draft PR #26). System Node v22.22.1 cannot load the better-sqlite3 native binding (ERR_DLOPEN_FAILED) — node24 toolchain required. Signature tampering correctly rejected; the SEC-001 flaw is issuance, not verification.

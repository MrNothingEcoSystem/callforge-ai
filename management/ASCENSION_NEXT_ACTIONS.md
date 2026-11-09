# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-09T04:25Z (cycle 1)

## Highest priority (this cycle's verdict)
M02 PR #7 is NOT production identity. Before M02 can be accepted:
1. SEC-001: replace unauthenticated /oauth/authorize self-assertion with a real IdP / authenticated user step; a caller must not be able to mint tenant_admin for an arbitrary tenant. Until then relabel M02 as simulation baseline only.
2. SEC-002: fail closed when CALLFORGE_TOKEN_SECRET is unset in any non-test mode; remove 'callforge-dev-secret-change-me' fallback.
3. Non-blocking: timing-safe PKCE compare, delete used codes, scope conversation fixtures or document them as global, re-check role->scope at token validation.

## Next engineering (after SEC-001/002 decision, or in parallel as simulation)
- M03 increment 1: durable persistence/workflow design (Postgres vs SQLite decision, TECH-004) — design only, no live activation.
- Issues #2-#6 (audit verifyChain, graceful close, rowid ordering, node:crypto in tests, listen/close smoke) — schedule into M02/M03 branches.

## Gates needing owner
EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

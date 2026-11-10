# CALLFORGE OMEGA — Ascension Next Actions

Updated:  (this cycle)

## In flight

- M03-2a quota wiring: PR #22 (draft, `m03-2-quota-wiring` @ `8adef30`) → main. Wires remaining-call quotas into POST /simulate/call and stateMachine releases (workflow/quota.mjs, workflow/stateMachine.mjs, server.mjs). Tests: Node v24.22.2 vitest — 14 files, 112/112 passed (re-verified 2026-11-10T00:55Z), including new tests/m03-quota-wiring.test.mjs. Independent review ACCEPT — no blocking findings; verdict recorded in ASCENSION_MILESTONES.json + ASCENSION_PROGRESS.md. Awaiting owner merge decision. No merge without authorization.
- Cleanup PR #51 (TECH-002, issues #2/#4/#5/#6): draft, `cleanup/m01-followups` @ `4c99e8c` → main. Fixes: verifyChain predecessor seed (#2), rowid ordering in getEvents (#4), node:crypto imports in tests (#5), start()/close smoke test (#6). Tests: 13 files / 112/112 passed on Node v24.22.2. Awaiting owner merge decision. No merge without authorization.
- Issue #8 MCP surface: draft PR #26 (`m09-remote-mcp` @ `5785f0f`) → main. Verified this cycle: 14 files / 122 tests passed on Node v24.22.2, incl. new tests/m09-mcp.test.mjs. Token-derived tenant enforcement, `create_dev_token` excluded from remote registry, scope enforcement, 413/400/-32602/-32601 handling, auth-before-body. Awaiting owner merge decision. No merge without authorization.
- Cycle 33 ledger: PR #52 (`docs/ascension-cycle-033` @ `0fadbc1` → main) draft, open.

## Next engineering (unblocked; independent of owner gates)

1. M04 research track (parallel): UAE requirements register with source/jurisdiction/effective-date/legal-review status (feeds EXT-002).
2. Issue #8 is code-complete; no further engineering work until owner merge of PR #26.

## Gates needing owner (no engineering action possible)

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). SEC-001 IdP decision blocks M02 production-identity acceptance and any external deployment; M09 cannot close until M02/SEC-001 resolves. No merge/deploy/live-call/paid action taken this cycle.

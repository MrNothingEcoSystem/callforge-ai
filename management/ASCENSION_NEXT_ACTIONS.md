# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-10T00:17Z (this cycle)

## In flight

M03-2a quota wiring: PR #22 (draft, head `8adef30`) `m03-2-quota-wiring` → main. Wires remaining-call quotas into POST /simulate/call and stateMachine releases (workflow/quota.mjs, workflow/stateMachine.mjs, server.mjs). Tests: Node v24.22.2 vitest — 14 files, 112/112 passed, including new tests/m03-quota-wiring.test.mjs. Awaiting independent review, then owner merge decision. No merge without authorization.

## Next engineering (unblocked; independent of owner gates)

1. Independent review of PR #22 — record verdict; fix blocking findings on branch if any.
2. Bundle issues #2, #4, #5, #6 (audit verifyChain, rowid ordering, node:crypto in tests, listen/close smoke) into one cleanup PR.
3. Issue #8 (MCP surface) — before M09.
4. M04 research track (parallel): UAE requirements register with source/jurisdiction/effective-date/legal-review status (feeds EXT-002).

## Gates needing owner (no engineering action possible)

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). SEC-001 IdP decision blocks M02 production-identity acceptance and any external deployment. No merge/deploy/live-call/paid action taken this cycle.

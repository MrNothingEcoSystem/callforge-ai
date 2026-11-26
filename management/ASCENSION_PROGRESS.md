# CALLFORGE OMEGA — Ascension Progress

Updated: 2026-11-26T21:20Z (cycle 205). Remote main `28c9040`. No completion percentages are claimed.

- M00 Discovery: complete (ef277d2)
- M01 Baseline stabilization: accepted with follow-ups (76bb062), blocker SRC-001/EXT-001
- M02 Production identity and tenant isolation: **merged** (PR #7 at 28c9040 via b5c40bc lineage). SEC-002 fixed (fail-closed secret), SEC-003 scope re-derivation fixed on PR #191. SEC-001 (unauthenticated authorize, no real IdP) still gates production deployment — EXT-004-adjacent owner decision.
- M03 Durable workflow: **merged** — M03-1 (PR #9) and M03-2 orchestration (PR #20) on main.
- M09 Remote MCP server: step 1 (opt-in Streamable HTTP transport) on draft PR #192, review ACCEPT WITH FOLLOW-UPS, F1 fixed. Steps 1-5 done on the branch (transport, CORS, discovery/RFC8707, rate limiting, annotations/securitySchemes, elicitation + batch gate). Remaining: §7 slices needing no decision (D replay, F checklist), IdP swap (SEC-001, owner-gated) which unblocks §7B, app-review pass. Conformance §7 A/C/D/E/F mechanised cycle 205 (`tests/m09-conformance.test.mjs`, F18 found+fixed).
- Open review-complete drafts awaiting owner merge, in order: PR #189 (issues #2/#4/#5/#6), PR #191 (issue #8), PR #192 (M09 step 1).
- M04-M08, M10-M16: pending/design, blocked as listed in ASCENSION_MILESTONES.json and ASCENSION_BLOCKERS.md.

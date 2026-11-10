# CALLFORGE OMEGA — Ascension Progress

Updated:  (this cycle; remote main synced at 28c90405b5da65807b9139f05ce0f30bc232bcfe = local main; checkout on docs/ascension-cycle-034)

- M00 Discovery: complete (ef277d2)
- M01 Baseline stabilization: accepted (76bb062)
- M02 Production identity and tenant isolation: merged to main as simulation baseline (PR #7, head 4368955, 73/73, CI pass). SEC-001 (unauthenticated /oauth/authorize, self-asserted tenant/role) remains open — blocks production-identity acceptance and any external deployment; awaiting owner IdP decision. SEC-002/SEC-003 fixed in 65ff410.
- M03 Durable persistence and workflow engine: M03-1 merged (PR #9, dec034e, ACCEPT at 6c0ffb9, 66/66, CI pass). M03-2 durable workflow orchestration merged (PR #20, 28c9040, independent re-review ACCEPT at a2ebe0c, +6 regression tests). M03-2a quota wiring implemented and tested (8adef30, PR #22 draft, full suite 112/112 on Node v24.22.2); independent review ACCEPT — no blocking findings; awaiting owner merge decision. PostgreSQL deferred with documented rationale.
- TECH-002 M01 follow-up cleanup (issues #2/#4/#5/#6): fixed on `cleanup/m01-followups` @ `4c99e8c`, draft PR #51 → main, 13 files / 112/112 tests on Node v24.22.2; awaiting owner merge decision.
- M09 Production remote MCP server: issue #8 MCP surface implemented + verified (`m09-remote-mcp` @ `5785f0f`, draft PR #26 → main, 14 files / 122 tests passed on Node v24.22.2); M09 pending, blocked by M02 SEC-001 (owner IdP decision) and PR #26 merge.
- M04-M08, M10-M16: pending/design, blocked as listed in ASCENSION_MILESTONES.json.

No completion percentages are claimed.

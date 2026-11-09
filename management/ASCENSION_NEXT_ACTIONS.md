# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-09T09:30Z (cycle 11)

## Highest priority

1. **PR #26 (M09)**: independent re-audit verdict ACCEPT WITH FOLLOW-UPS as simulation baseline at 87ae898 (120/120, CI pass). Owner merge decision on draft PR #26 pending. Before any production MCP claim: G-1/G-2 fixes + SEC-001 IdP.
2. **SEC-001** (M02/M09 shared production-identity gate): owner IdP decision required; until then M02/M09 are simulation baselines, must not be network-exposed as production identity.
3. Small bounded fixes available without owner input: G-1 (readOnlyHint derivation), G-2 (auth-before-body on /mcp), SEC-003 remainder (scope re-derivation at token validation), conversation fixture scoping decision.

## Next engineering

- M03-2 quota wiring (PR #22) + M04 UAE plan (PR #24) await owner merge; M09 quota consume/release for MCP tools tied to PR #22.
- Issues #2, #4, #5, #6 cleanup PR #14 open; issue #8 (MCP surface) largely addressed by PR #26.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

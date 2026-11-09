# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-09T07:45Z (cycle 8)

## Highest priority

1. Owner merge decision on draft PR #22 (quota wiring, audit ACCEPT WITH FOLLOW-UPS, 112/112 + CI PASS). No merge taken by dispatcher.
2. SEC-001 production IdP: replace unauthenticated /oauth/authorize self-assertion with a real IdP / authenticated user step. Owner decision required (IdP choice). Until then: simulation baseline only, no network exposure.
3. Owner merge decision on draft PR #24 (M04/M09 design docs, unmerged).

## Next engineering (unblocked)

- M04 implementable controls (M04-1 quota-gated campaign dialing on top of PR #22; M04-2 DNCR/consent registry) — design only until EXT-002 sign-off; see draft PR #24.
- PR #22 follow-ups (non-blocking): skip unused-increment for limit<=0 rows; release-after-quota-row-added edge; fail-closed default for M04 campaign dialing.
- M09 MCP surface (issue #8) before M09 milestone.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken by dispatcher.

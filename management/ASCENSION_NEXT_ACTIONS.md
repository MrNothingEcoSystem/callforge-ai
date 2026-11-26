# CALLFORGE OMEGA — Ascension Next Actions

Updated: 2026-11-09T04:25Z (cycle 1)

## Highest priority (supervisor-verified 2026-11-09T04:30Z)

M02 PR #7: independent audit ACCEPT WITH FOLLOW-UPS; SEC-002 + part of SEC-003 fixed in 65ff410 (73/73, CI PASS). Remaining before M02 can be accepted as production identity:

1. SEC-001: replace unauthenticated /oauth/authorize self-assertion with a real IdP / authenticated user step. Until then M02 is a simulation baseline and must not be network-exposed.
2. Non-blocking: scope re-derivation from role at token validation; conversation fixture scoping decision (currently documented global).
3. Owner merge decision on PR #7 (draft, unmerged).

## Next engineering

- M03-1 done on PR #9 (dec034e): migrations, outbox, state machine, webhook inbox, backup/restore. Next: independent review of PR #9, then M03-2 (dispatcher loop, quota counters).
- Issues #2, #4, #5, #6 (audit verifyChain, rowid ordering, node:crypto in tests, listen/close smoke) — bundle into one cleanup PR. Issue #8 (MCP surface) before M09.
- M04 research track (parallel): UAE requirements register with source/jurisdiction/effective-date/legal-review status.

## Cycle 195 — M09 step 1 transport (PR #192)

Draft PR #192 (`m09-streamable-http`, stacked on #191) adds the opt-in remote MCP transport
(`MCP_HTTP_ENABLED=1`): bearer-enforced POST /mcp, RFC9728 challenge + metadata, Origin
allow-list, protocol-version gate, body cap. Review record `management/PR192_REVIEW_RECORD.md`,
verdict ACCEPT WITH FOLLOW-UPS with the Medium 413-socket defect fixed before push.

Merge order for the owner is now #189 → #191 → #192. Next engineering after that, in order:
(1) F2 CORS preflight honouring the Origin allow-list, (2) RFC9728/8414 discovery + RFC8707
audience binding, (3) per-tenant rate limiting, (4) tool annotations + securitySchemes and
removal of `access_token`/`tenant_id` from the remote registry, (5) elicitation for C2 tools,
(6) IdP swap once SEC-001 is decided.

## Cycle 194 — issue #8 review + remediation (PR #191)

Independent-style re-review in an isolated worktree found two High defects and both are fixed on `mcp-tool-tenant-auth`: onboarding under a token stranded the caller on a tenant its token could not address (now returns a scoped credential), and tokens minted by `create_dev_token` were rejected by the tool authorizer (now accepted via `validateDevToken`). Unknown role claims now fail closed. Record: `management/PR191_REVIEW_RECORD.md`. PR #191 is review-complete but stays draft: merge order is #189 then #191, both owner-gated. Retiring unauthenticated (no-token) calls for non-local use remains an owner decision.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

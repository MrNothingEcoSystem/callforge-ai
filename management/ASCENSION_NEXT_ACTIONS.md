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
(1) F2 CORS preflight honouring the Origin allow-list — **done**, cycle 196 (`4ee48f7`),
(2) RFC9728/8414 discovery + RFC8707 audience binding — **done**, cycle 197 (`4fa9dd5`),
(3) per-tenant rate limiting — **done**, cycle 198 (`b349b06`), (4) tool annotations + securitySchemes and
removal of `access_token`/`tenant_id` from the remote registry — **done**, cycle 199 (`2d79fc2`),
(5) structured outputs and elicitation for C2 tools, (6) IdP swap once SEC-001 is decided.

Cycle 197 detail: discovery documents now carry absolute URIs (RFC8414 §2), the `/mcp`
path-aware well-known variants answer, `resource_indicators_supported` is advertised, and
`authorize` accepts an RFC8707 `resource` that becomes the token's `aud` alongside
`callforge-api`. The `/mcp` gate refuses a token minted for another resource (401 +
`invalid_token`). **Owner-visible behaviour change:** a token without a `resource` is now
rejected there unless `MCP_REQUIRE_RESOURCE_AUDIENCE=0`. Still open in this area: the `iss`
claim is the literal `callforge` while RFC8414 metadata publishes a URL issuer — closing
that needs the SEC-001 IdP decision, not more local code.

## Cycle 198 — M09 step 3 rate limiting (PR #192)

`mcp-rate-limit.mjs` + wiring: per-tenant caller bucket (`MCP_RATE_LIMIT_PER_MINUTE`)
and per-tenant/per-tool bucket (`MCP_RATE_LIMIT_TOOL_PER_MINUTE`) for
`simulate_call`/`list_history`/`generate_report`; 429 + `Retry-After` +
problem+json; discovery/preflight/health unthrottled; both disabled by default.
In-process and restart-volatile — edge/KV buckets remain the production path, and a
spammed expensive tool also spends caller budget (order is caller → tool). Note the
rejected-tool request still consumes a caller token. Next M09 step: (4) tool
annotations + securitySchemes and removal of `access_token`/`tenant_id` from the
remote registry.

## Cycle 199 — M09 step 4 remote registry metadata (PR #192)

`mcp-tool-metadata.mjs` is now the remote registry: the owner-facing subset with explicit
annotations and one least-privilege `securitySchemes` scope per tool, `create_dev_token`
(C3) delisted, `access_token`/`tenant_id` gone from the published schema whenever bearer
auth is on (passthrough keeps the 403 mismatch net and the onboarding credential hand-off).
7 tests, live probe, full suite 166/166. Review record F4 closed with F7–F10. Next M09 step:
(5) structured outputs + elicitation for C2 tools — that turns the C1/C2 confirmation levels
from annotations into an actual gate. Note for the owner: a remote client can no longer
mint its own dev token, so provisioning has to come from the IdP or an operator-issued token.

## Cycle 194 — issue #8 review + remediation (PR #191)

Independent-style re-review in an isolated worktree found two High defects and both are fixed on `mcp-tool-tenant-auth`: onboarding under a token stranded the caller on a tenant its token could not address (now returns a scoped credential), and tokens minted by `create_dev_token` were rejected by the tool authorizer (now accepted via `validateDevToken`). Unknown role claims now fail closed. Record: `management/PR191_REVIEW_RECORD.md`. PR #191 is review-complete but stays draft: merge order is #189 then #191, both owner-gated. Retiring unauthenticated (no-token) calls for non-local use remains an owner decision.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

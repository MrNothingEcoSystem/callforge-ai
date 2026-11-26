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
(5) structured outputs and elicitation for C2 tools — **done**, cycle 200 (`cd4603f`),
(6) IdP swap once SEC-001 is decided.

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

## Cycle 200 — M09 step 5 C2 confirmation gate + structured outputs (PR #192)

`mcp-elicitation.mjs` is now the server-side C2 gate. Only `configure_business`, and only when it
touches a licensed/externally-binding flag (`license_number`, `license_expiry`,
`dncr_check_enabled`, `recording_consent_required`), is gated; the call answers
`resultType:"input_required"` with a typed `confirm` request and a `requestState` fingerprinted over
the risky arguments, and the client resumes with `inputResponses`. Decline/cancel/`confirm:false`
write nothing and audit `elicitation_declined`; a stale state is re-issued rather than applied.
Every exposed tool now publishes an `outputSchema` and returns `structuredContent`
(`MCP_ELICITATION_GATE=0` restores annotations-only). 9 new tests, full suite 156/156 executed pairs.
Next M09 step: (6) IdP swap once SEC-001 is decided, then conformance suite §7 and the OpenAI
app-review pass. (Batch gate F11 closed in cycle 201 — see the cycle 201 section at the end.) Owner-visible: a remote client that ignores `input_required` can no longer change
licensed settings in one shot.

## Cycle 194 — issue #8 review + remediation (PR #191)

Independent-style re-review in an isolated worktree found two High defects and both are fixed on `mcp-tool-tenant-auth`: onboarding under a token stranded the caller on a tenant its token could not address (now returns a scoped credential), and tokens minted by `create_dev_token` were rejected by the tool authorizer (now accepted via `validateDevToken`). Unknown role claims now fail closed. Record: `management/PR191_REVIEW_RECORD.md`. PR #191 is review-complete but stays draft: merge order is #189 then #191, both owner-gated. Retiring unauthenticated (no-token) calls for non-local use remains an owner decision.

## Gates needing owner

EXT-001..EXT-009 unchanged (see ASCENSION_BLOCKERS.md). No merge/deploy/live-call/paid action taken.

## Cycle 201 — M09 review F11 closed (batch C2 gate)

Batch JSON-RPC requests used to reach the SDK dispatch wholesale, so a C2 `configure_business`
inside a batch applied unconfirmed. `mcp-http.mjs` now answers a gate-touching batch itself:
gated items get `input_required` / declined / stale re-issue, other items execute through the
same SDK request handler, and batches without a gated call take the normal path (F11 closed).
5 regression tests, live probe pass1/pass2, full suite 180 tests 0 failed. New follow-ups:
F14 (Low — a resumed batch re-executes its non-gated items; accepted) and F15 (Low, pre-existing
— anonymous `onboard_tenant` returns `credential: null` that its own `outputSchema` rejects, so
the call reports an output-validation error even though the tenant is created). Next M09 step
stays (6) IdP swap once SEC-001 is decided, together with the F15 fix and conformance suite §7;
owner merge order is still #189 → #191 → #192.

## Cycle 202 — M09 review F15 closed (anonymous onboarding output schema)

F15 fixed: the `onboard_tenant` `outputSchema` used `.optional()` for `credential`, which rejects
the `null` that anonymous mode legitimately returns, so a created tenant reported an
output-validation error. Now `.nullish()`; handler untouched; 2 regression tests + live probe.
Full suite 182 tests 0 failed, CI SUCCESS. Remaining open on PR #192: F12, F13 (Low/Info), F14
(accepted). Next M09 step is now (6) IdP swap once SEC-001 is decided, then conformance suite §7;
those need no further local gate work. Owner merge order unchanged: #189 → #191 → #192.

## Cycle 203 — M09 review F12 closed (scope check before the gate)

F12 fixed: the C2 gate answered `input_required` before the tool authorizer ran, so a token without
the tool scope got a confirmation form and an `elicitation_*` audit row and only 403'd on the
resume. `preGateAuth()` now checks the authoritative `TOOL_SCOPES` map (exported from
`tools/index.mjs`) against the verified token before any gate answer, on the single-call and batch
paths; a denied item gets the authorizer's tool-error result and no gate audit row, and the rest of
a batch still executes. Anonymous calls keep the annotation-only path. 4 regression tests, live
probe with read-scoped vs admin tokens, full suite 186 tests 0 failed, CI SUCCESS. Reviewers should
note the published `securitySchemes` scope (`callforge:config`) and the enforced scope (`admin`) are
different vocabularies — reconciling them is a separate M09 item. Open on PR #192 now: F13 (Info),
F14 (accepted). Next M09 step is still (6) IdP swap once SEC-001 is decided, then conformance suite
§7; owner merge order unchanged: #189 → #191 → #192.

## Cycle 204 — M09 F16 closed (published scope == enforced scope)

F16 (raised by cycle 203) fixed in `7add464`: the published `securitySchemes` are now the enforced
`TOOL_SCOPES` value per tool, and `/oauth/authorize` accepts the `callforge:` alias so previously
documented scope names still work. The issuer previously rejected every published scope with
`400 Unknown scope requested` — a client following `tools/list` could not get a token at all — and
`simulate_conversation`/`generate_report`/`validate_compliance` published a scope the authorizer
does not accept. Discovery `scopes_supported` is derived from `ROLES` now (the phantom `write` is
gone). A drift test asserts published == enforced for every tool; alias retention is recorded as
Info F17. 25/25 targeted, full suite 188 tests 0 failed, CI SUCCESS. Open on PR #192: F13 (Info),
F14 (accepted), F17 (Info). Next M09 step is still (6) IdP swap once SEC-001 is decided, then
conformance suite §7; owner merge order unchanged: #189 → #191 → #192.

## Cycle 205 — conformance suite §7 (PR #192)

`tests/m09-conformance.test.mjs` mechanises design §7 A/C/D/E/F (19 tests) and closed the
defect it found, **F18**: the version gate advertised `2026-07-28` while the SDK rejected it
and withheld three versions the SDK accepts. The gate now imports the SDK list and normalises
an SDK-unknown header (on `req.headers` and `req.rawHeaders`) so 2026 clients are served;
F19 records that a real SDK bump should retire the shim.

Next, in order: (1) the remaining §7 slices that need no owner decision — D idempotent-replay
equality, F OpenAI review-checklist numbers; (2) SEC-001 IdP swap (owner), which unblocks §7B
issuer/DCR/CIMD, the URL `iss` and step 6; (3) §7G interop against Inspector/ChatGPT/Codex
(needs a reachable deployment); (4) OpenAI app-review pass (EXT-008). Merge order is
unchanged: #189 → #191 → #192.

## Cycle 206 — §7 D replay equality + F OpenAI checklist (PR #192)

`tests/m09-conformance.test.mjs` now pins idempotent replay (`simulate_call` replay → same
`call_intent_id`, one intent, one audit row), sweeps every read-only-annotated tool for zero
writes, pins `validate_compliance` replay to a byte-identical document with exactly one extra
audit row, and covers the OpenAI checklist: a `justification` on every mutating registry entry
(readers may not be destructive, no tool is destructive today), no bearer/debug/stack text in
the audit trail, and a future bounded token expiry. The registry's `entry()` gained an optional
`{ exposed, justification }` object; annotation values are unchanged.

**No local §7 slice remains.** Next, in order: (1) SEC-001 IdP swap (owner), which unblocks
§7B issuer/DCR/CIMD, the URL `iss`, F19's shim and step 6; (2) §7G interop against
Inspector/ChatGPT/Codex (needs a reachable deployment); (3) OpenAI app-review pass (EXT-008).
Merge order is unchanged and entirely owner-gated: #189 → #191 → #192.

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

## Cycle 207 — M09 step 6 verifier (PR #192, external IdP seam)

`idp.mjs` is now the SEC-001 answer's engine half: OIDC bearer tokens are verified
against a configured JWKS (iss `https://…`, `kid` rotation, aud/RFC8707 resource,
exp/nbf with skew), and claims map to tenant/role with scopes still re-derived from
the role. Off by default (`CALLFORGE_IDP_MODE=external`), synchronous, and the local
HS256 path is untouched — so the 186 pre-existing tests never moved. F20 (Medium) from
the review is closed with `CALLFORGE_OIDC_ALLOW_LOCAL_TOKENS=0` for strict mode.

**What the owner decision now is:** one named legal/DPO sign-off on the dossier's
question (US-hosted identity under WorkOS/Clerk vs Keycloak-in-UAE for residency), then
the vendor's issuer URL, JWKS URI and tenant claim go into env. §7B DCR/CIMD, the
discovery `iss` and F19's shim follow directly from that choice; none of them block the
rest of the program.

Nothing local remains on M09 before the decision. After it: §7B DCR/CIMD, §7G interop
(needs a reachable deployment), OpenAI app-review pass (EXT-008). Merge order unchanged
and owner-gated: #189 → #191 → #192.

## Cycle 208 — TECH-009 closed (worker SIGABRT; PR #193)

The suite was losing two workers per run to a `better-sqlite3` 11.10 native teardown abort
(`tests/audit.test.mjs`, `tests/m03-orchestration.test.mjs`; `tests/store.test.mjs`
intermittently), exit 1, ~36 collected tests never counted — every suite number in this ledger
was therefore soft. `^12.11.1` ships Node 24 bindings and the abort is gone: two consecutive full
runs, 22/22 files, 239/239 tests, exit 0, plus one independent worktree reproduction.

Merge order is now **#193** (independent, dep-only, rebasable to `main` if the owner wants it
first) **→ #189 → #191 → #192**. Review record: `management/TECH009_REVIEW_RECORD.md`, verdict
ACCEPT, R2 (assert file/test counts, not just exit code) and R3 (lockfile re-prettify) recorded as
follow-ups.

M09 next step is unchanged and still owner-gated: SEC-001 IdP sign-off, then §7B DCR/CIMD, the
discovery `iss`, F19's shim and step 6 vendor wiring; after that §7G interop (needs a reachable
deployment) and the OpenAI app-review pass (EXT-008).

## Cycle 209 — TECH-009 R2 closed (guarded suite runner; PR #193)

R2 from `management/TECH009_REVIEW_RECORD.md` is fixed in `2907515`: `pnpm test` now runs
`scripts/guard-suite.mjs`, which fails the run on a file that never reports, a file reporting zero
assertions (verified: a worker killed pre-collection shows as `passed` with no results), any failed
test or file, and a collected count under `tests/.test-floor.json`. CI needed no change, `test:raw`
keeps the bare runner, `--bump` raises the floor, and a guard-suite test fails if the floor exceeds
the files on disk. 23/23 files, 242/242, negative paths red both ways. Record:
`management/TECH009_R2_REVIEW_RECORD.md`, verdict **ACCEPT**.

R3 (lockfile re-prettify after every dep change) stays accepted/noted. Open on PR #193 after this
cycle: none locally. Merge order unchanged and owner-gated: **#193 → #189 → #191 → #192**.
M09 next step is still the SEC-001 sign-off, then §7B DCR/CIMD, the discovery `iss`, F19's shim and
step 6 vendor wiring; then §7G interop (needs a reachable deployment) and EXT-008 app review.

## Cycle 210 — R2 hardening + CI delivery incident (PR #193)

`854697d` splits the guard's judgement into a unit-tested pure module
(`scripts/lib/suite-integrity.mjs`, 13 tests) and adds `workflow_dispatch`. **EXT-010:** the
`pull_request` event queued no run for five consecutive heads while `workflow_dispatch` worked
immediately (run 45916816349 SUCCESS), so every head from now on needs an explicit dispatch
and the queue must be verified with `gh run list` before a head is called green. Review record
`management/TECH009_R2_HARDENING_REVIEW_RECORD.md`, verdict ACCEPT.

Everything left on PR #193 is owner-gated: merge order #193 → #189 → #191 → #192, and the
SEC-001 IdP sign-off (then §7B DCR/CIMD, the discovery `iss`, F19's shim, step 6 wiring, §7G
interop, OpenAI app-review EXT-008).

## Cycle 211 — PR #193 stack conflict resolved (docs-only merge)

`4dc07fc` merges the base into #193 and keeps both ledger tails chronologically; PR is
`MERGEABLE` again and `verify` is SUCCESS on the head (run 45920636504). EXT-010 (Actions event
delivery) recovered as observed — a `pull_request` run queued again; workaround and `gh run
list` verification stay in force. Review record `management/PR193_STACK_SYNC_REVIEW_RECORD.md`,
verdict ACCEPT; if the owner prefers rebasing #193 onto `main`, drop this merge rather than
carry it.

Nothing local remains on #193. Everything is owner-gated: **#193 → #189 → #191 → #192** and the
SEC-001 IdP sign-off, then §7B DCR/CIMD, the discovery `iss`, F19's shim, step 6 wiring, §7G
interop (needs a reachable deployment) and EXT-008 app review.

## Cycle 212 — F13 closed (requestState signing, PR #192)

F13 (Info, open since cycle 200) closed: `requestState` is now `v1.<payload>.<hmac>` and
verified before the fingerprint is trusted, so a state minted for one argument set cannot be
hand-edited into another. Unsigned/edited/other-key states are treated as stale and
re-issued; no gate decision changed. 3 unit tests + 1 transport test. On this base the raw
suite still SIGABRTs 4 workers (`better-sqlite3` 11.10) — the guarded suite at `276c6db`
merged with #193 is 256/256, and #193 is first in the merge order for exactly that reason.

`workflow_dispatch` is now on `ci.yml` in this branch too (`301b5e0`): the EXT-010
`pull_request` delivery outage left pushes unverified and this is the escape hatch. It
duplicates two lines #193 carries — trivial to reconcile on merge.

Open Info items on #192: F17 (alias retention), F19 (initialize shim until the SDK ships
2026-07-28), F22 (per-request config parse), F23 (no revocation check) and H1–H3 from the
F13 record. None warrants code before SEC-001, which stays the owner decision.

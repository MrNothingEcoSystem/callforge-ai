# PR #192 — M09 Streamable HTTP transport: independent review record

Reviews: two passes. First review on `2e1a470` (fresh detached worktree
`/root/.hermes/cache/scratch/cf-pr192`), remediation committed, re-probe on the fixed
code. `delegate_task` is still unavailable in the cron runtime, so "independent" means a
separate worktree plus executable probes rather than reuse of the authoring context.

Scope: transport only (opt-in `MCP_HTTP_ENABLED=1`). No merge, deploy, live calls or spend.

## Verdict: ACCEPT WITH FOLLOW-UPS

## Findings

| ID  | Severity   | Finding                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                              |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Medium** | `readBody` called `req.destroy()` the moment the body cap was crossed, so the client got a socket reset (`fetch failed`) instead of the 413 the code intended to send. Probe with `MCP_MAX_BODY_BYTES=200` reproduced it every time.                                                                     | **Fixed** — data listener detached, remainder drained with `req.resume()`, 413 written. Regression test asserts a real 413 JSON body.               |
| F2  | Low        | `server.mjs` sets `Access-Control-Allow-Origin: *` globally, and the OPTIONS preflight short-circuits before the transport's Origin check. A disallowed browser origin gets a successful preflight and only then a 403 on the POST. Curl/non-browser clients are unaffected because they send no Origin. | **Fixed in `4ee48f7`** — `/mcp` preflight echoes the matched origin + `Vary: Origin`, 403s unlisted ones; other paths keep `*`; 5 regression tests. |
| F3  | Low        | JSON-RPC batch arrays are accepted by the SDK but a one-element batch returns a single result object, not an array; multi-element batches are untested here. 2026-07-28 deprecates batching.                                                                                                             | Documented.                                                                                                                                         |
| F4  | Low        | `tools/list` still advertises `access_token` and `tenant_id` in every input schema. Both are optional now, so this is documentation surface, not a behaviour bug.                                                                                                                                        | Deferred to M09 step 3 (strip from the remote registry).                                                                                            |
| F5  | Nit        | Server version is hardcoded in the transport instead of sharing `SERVER_VERSION`.                                                                                                                                                                                                                        | Follow-up.                                                                                                                                          |
| F6  | Design     | Stateless only: no `Mcp-Session-Id`, GET/DELETE answer 405, no resumability. `MCP_HTTP_ALLOW_ANONYMOUS=1` falls back to the legacy unauthenticated tool path.                                                                                                                                            | As designed for 2026-07-28.                                                                                                                         |

## Probe evidence (fixed head)

- oversize → `413 {"error":"Payload too large"}`; bad signature → `401 {"error":"Invalid token"}`.
- one-element batch → `200` and the single result; `not json` → `400 -32700`; `text/plain` body → `415`; unknown method → `200 -32601`; `tools/list` → 200 with the full registry.
- Real server (ephemeral port) with the flag on: `/health` 200, `/mcp` 401 with `WWW-Authenticate: Bearer resource_metadata=…`, RFC9728 metadata served, `GET /mcp` 405.
- `tests/m09-mcp-http.test.mjs` 7/7. eslint 0, prettier clean, tsc clean.
- F2 probes: OPTIONS `/mcp` allowed origin → 204 + echoed ACAO + `Vary: Origin`; unlisted origin → 403 JSON with no ACAO; no Origin → 204 `*`; `/health` unaffected; allow-list unset → 204 `*`. `tests/m09-cors-preflight.test.mjs` 5/5.

## Residual merge conditions

Draft, stacked on #191 (merge order #189 → #191 → #192). Later M09 steps remain: discovery /
RFC8707 audience binding, rate limiting, annotations and securitySchemes, elicitation,
IdP swap. Transport alone does not make M09 accepted; production exposure still needs the
SEC-001 IdP decision and EXT-004 deployment approval.

## Cycle 199 — F4 closed (remote registry metadata)

Independent read-only pass in a detached worktree at `2d79fc2`, then a second pass at
`8def998`. F4 above is closed: with bearer auth on, `tools/list` no longer publishes
`access_token` or `tenant_id`, and `create_dev_token` (C3) is not registered on the remote
surface at all. Every listed tool carries `title`, explicit `readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint` and one least-privilege
`securitySchemes` OAuth2 entry from `mcp-tool-metadata.mjs`, which is also the review gate
for the list. Annotations match design §4 row for row; `readOnlyHint` is false for the two
mutating families and `idempotentHint` is false for `onboard_tenant`.

| ID  | Severity | Finding                                                                                                                             | Status                                                                                                                                                  |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F7  | Low      | Stripping `tenant_id` alone removed the 403 cross-tenant safety net, because the SDK hands the handler the zod-parsed arguments.    | **Fixed** — the remote input schema is a passthrough object, so a stray `tenant_id` still reaches `toolAuth` and still 403s. Regression test covers it. |
| F8  | Low      | Stripping `access_token` would have broken the onboarding hand-off, where the credential is returned to the caller for later calls. | **Fixed** — `toolAuth` already prefers an explicit argument over the transport token; test asserts an onboarded `cf_dev_` credential works.             |
| F9  | Nit      | `additionalProperties: {}` now appears on every advertised schema (passthrough rendering).                                          | Accepted — semantically "any"; the alternative loses F7.                                                                                                |
| F10 | Nit      | Annotations are hints; nothing enforces confirmation level C1/C2 yet.                                                               | Documented in design §4; elicitation is the next step.                                                                                                  |

Probe (real `server.mjs`, port 3813, flag on, bound token): `tools/list` → 10 tools,
`create_dev_token` absent, `simulate_call` annotations
`{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}`,
`_meta.securitySchemes=[{"type":"oauth2","scopes":["callforge:simulate"]}]`, no
`access_token`/`tenant_id` properties. `tests/m09-tool-metadata.test.mjs` 7/7; full suite
166 passed / 19 files, 0 failures; eslint 0, prettier clean, tsc clean.

## Cycle 200 independent pass — M09 step 5 (`cd4603f`)

Read-only pass in a detached worktree at `cd4603f` (`pnpm install --frozen-lockfile`,
`tests/m09-elicitation.test.mjs` 9/9 reproduced). Verdict: **ACCEPT WITH FOLLOW-UPS**.

- F11 (Medium, open): a **batch** JSON-RPC request (`[{...},{...}]`) skips the gate entirely —
  `gate()` only runs for a single `tools/call`, so `configure_business` with a licensed flag
  inside a batch applies unconfirmed. Enabled-batch clients get no C2 protection.
- F12 (Low, open): the gate answers before the tool authorizer runs, so a token without the
  `callforge:config` scope can receive `input_required` (and an `elicitation_*` audit row) and only
  then 403 on resume. Correct outcome, one wasted round trip.
- F13 (Info): `requestState` is unsigned base64url JSON — forgeable, but only by the client that
  is itself choosing to confirm; the fingerprint's job is staleness, not authenticity. HMAC is the
  hardening if requestState ever carries state the client must not choose.

## Cycle 201 — F11 closed (batch gate)

Independent read-only pass in a detached worktree at `f2a109c`. F11 is closed: a JSON-RPC
batch that contains a C2 `tools/call` no longer reaches the SDK dispatch unconfirmed. The
transport now answers such a batch itself, item by item — gated items get
`input_required` (or a declined result, or a stale-state re-issue), every other item is
executed through the same SDK request handler the transport would have used, and a batch
with no gated call still takes the normal path unchanged. Batch notifications get no
response entry; a batch with a single gated item still answers a single object, matching
the SDK's one-element-batch behaviour (F3).

| ID  | Severity | Finding                                                                                                                                                                                                                                               | Status                                                                                                  |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| F11 | Medium   | Batch requests skipped the C2 gate entirely, so a licensed `configure_business` applied inside a batch.                                                                                                                                               | **Fixed** — per-item gate; 5 regression tests; live probe pass1 `input_required`, pass2 applied.        |
| F14 | Low      | A batch containing an already-issued confirmation is re-executed in full, including non-gated items, on resume.                                                                                                                                       | Accepted — batches are idempotent for the read tools and `onboard_tenant`; documented.                  |
| F15 | Low      | Pre-existing, found by the live probe: anonymous `onboard_tenant` returns `credential: null`, which its own `outputSchema` rejects (`expected object, received null`), so the call reports an output-validation error although the tenant is created. | Open follow-up, outside F11 scope.                                                                      |
| F16 | Medium   | Published `securitySchemes` were a parallel vocabulary (`callforge:*`) the issuer rejected with `400 Unknown scope requested`, and three tools published a scope the authorizer does not accept.                                                      | **Fixed** in cycle 204 — published scopes equal the enforced `TOOL_SCOPES`; alias accepted; drift test. |
| F17 | Info     | `callforge:` is an alias, not the canonical scope form.                                                                                                                                                                                               | Accepted — migrate both sides together if a real IdP is wired.                                          |

Probe (real `server.mjs`, port 3816, flag on, anonymous): batch [`configure_business{license_number}`,
`check_readiness`] → 200 with `input_required` for id 1 and a real readiness result for id 2;
resume with the returned `requestState` → `status: configured` for id 1 and id 2 still executes.
`tests/m09-elicitation.test.mjs` 14/14; unrelated M09 suites 37/37; full suite 180 tests
(161 in one run, `tests/tools.test.mjs` 19/19 re-run alone — known TECH-009 `better-sqlite3`
SIGABRT); eslint 0, prettier clean, tsc clean.

## Cycle 202 — F15 closed (anonymous onboarding output schema)

Independent read-only pass in a detached worktree at `0f518ab`. Root cause of F15 was one
wrong modifier: the published `onboard_tenant` output schema declared
`credential: z.looseObject({}).optional()`, and `.optional()` accepts `undefined`, not `null`.
Anonymous remote mode mints no dev token, so a _successful_ onboarding produced
`credential: null` and the SDK turned it into an output-validation error. Fix: the field is now
`.nullish()`; the handler is untouched. Reproduced first as a failing schema assertion, then
green.

| ID  | Severity | Finding                                                                                                                                              | Status                                                                                                                                                                  |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F15 | Low      | Anonymous `onboard_tenant` returned `credential: null`, rejected by its own `outputSchema`, so a created tenant reported an output-validation error. | **Fixed** — `nullish()`; 2 regression tests (schema null/object/absent, anonymous transport call); live probe shows `structuredContent.credential: null`, no `isError`. |

Scope check: the change only widens that one field. Authenticated onboarding still hands back
the `cf_dev_…` credential and the existing hand-off test still passes, so the loosening cannot
mask a missing token. `credential: null` is unreachable on stdio in any case, where no
`outputSchema` is published.

Verified at `0f518ab`: `tests/m09-tool-metadata.test.mjs` 9/9 reproduced from a clean install;
related M09 suites 38/38; full suite 182 tests, 0 failed (171 in the full run,
`tests/m03-workflow.test.mjs` 11/11 re-run alone — known TECH-009 SIGABRT); eslint 0, prettier
clean, tsc clean. Live probe (real `server.mjs`, port 3817, `MCP_HTTP_ALLOW_ANONYMOUS=1`):
health 200, anonymous `onboard_tenant` → 200, `structuredContent {status: "onboarded",
credential: null}`, no `isError`. CI verify SUCCESS (run 45882910723).

## Cycle 203 — F12 closed (scope before the gate)

Independent read-only pass in a detached worktree at `e29ee95` (`pnpm install
--frozen-lockfile`; `tests/m09-elicitation.test.mjs` 18/18 reproduced). F12 is closed.

`preGateAuth()` runs before the gate can answer, on the single-call and the batch path, using the
authoritative `TOOL_SCOPES` map (now exported from `tools/index.mjs` — the same one the tool
authorizer enforces, so the check cannot drift from the real requirement). A denied gated item
returns exactly the tool-error result `authFailure()` produces, writes **no** `elicitation_*`
audit row, and in a batch does not block the remaining items. Anonymous calls (no bearer) keep
the annotation-only path; `MCP_ELICITATION_GATE=0` is unchanged. Dev-token contexts now carry
`subject`/`scopes` like the authorizer's own context, which the check needs.

Two notes for the reviewer: the published `securitySchemes` scope (`callforge:config`) and the
enforced tool scope (`admin`) are different vocabularies — the enforced one is what matters here,
and mapping the published scopes onto the enforcer stays a separate M09 item; and the pre-check
is advisory only, the authorizer remains the authority (a call that passes it still re-checks).

Verified: `tests/m09-elicitation.test.mjs` 18/18 (4 new F12 cases: denial before
`input_required`, no gate audit row, admin still gated, batch denial with the rest executing,
anonymous path untouched); unrelated M09 suites 38/38; full suite 186 tests, 0 failed (170 in the
full run, `tests/audit.test.mjs` 16/16 re-run alone — known TECH-009 SIGABRT); eslint 0, prettier
clean, tsc clean. Live probe (real `server.mjs`, port 3819, read-scoped and admin tokens):
read-scoped gated call → tool error 403 `Insufficient scope: requires admin`, no licence written;
same in a batch with `check_readiness` still answering; admin token → `input_required`; audit
table holds exactly one `elicitation_requested` row, from the admin call.

Open on this PR after cycle 203: F13 (Info), F14 (accepted). F12 and F15 closed. The IdP swap
(step 6) and the `iss` URL-vs-literal conformance stay gated on SEC-001; merge order remains
#189 → #191 → #192.

## Cycle 204 — F16: published scope vocabulary vs enforced scope (closed)

Raised by cycle 203 and accepted as the next item. The published `securitySchemes` were a parallel
vocabulary (`callforge:config`, `callforge:report`, `callforge:compliance`, …) that the issuer did
not accept at all — `/oauth/authorize` validates against the bare `ALL_SCOPES` and answered
**400 `Unknown scope requested`**, so a client following `tools/list` or the discovery documents
could not obtain a token, let alone pass the authorizer. Three entries were also simply wrong:
`simulate_conversation` published `read` while the authorizer demands `simulate`,
`generate_report` published `report` and `validate_compliance` published `compliance` while both
enforce `read`.

Fix `7add464`, deliberately in three parts:

1. `mcp-tool-metadata.mjs` publishes the enforced value (`TOOL_SCOPES[name][0]`) per tool. The
   module cannot import `TOOL_SCOPES` — `tools/index.mjs` imports this module, so a top-level read
   would hit the TDZ — so a new test asserts `REMOTE_TOOL_METADATA[n].securitySchemes ===
[{oauth2, scopes:[TOOL_SCOPES[n][0]]}]` for every tool. That is the anti-drift guarantee, not a
   comment.
2. `oauth.mjs` accepts `callforge:<scope>` as an alias: requested scopes are de-prefixed and
   de-duplicated before the role check, and `validateAccessToken` de-prefixes claims too, so
   already-minted prefixed tokens keep working. Tokens are signed and echoed with the bare scope.
3. Discovery `scopes_supported` in both well-known documents is now `SUPPORTED_SCOPES` (derived
   from `ROLES`) instead of a hardcoded list that advertised a `write` scope no role holds.

No widening: the enforcement maps are untouched, only the published names and the issuer's input
normalisation changed. Verified: `tests/m02-oauth.test.mjs` + `tests/m09-tool-metadata.test.mjs`
25/25 (2 new: alias accepted then enforced token scopes, published == enforced for every tool),
reproduced in a detached worktree at `7add464`; unrelated suites unaffected; full suite 188 tests,
0 failed (172 in the full run, `tests/audit.test.mjs` 16/16 re-run alone — known TECH-009
SIGABRT); eslint 0, prettier clean, tsc clean; CI SUCCESS run 45891967433. Live probe (real
`server.mjs`, port 3821): discovery advertises `[simulate, read, audit, admin]`, `callforge:read`
authorize → code → token with `scope: read`, `tools/list` shows bare scopes equal to the enforced
ones, admin token `configure_business` → `configured`, operator token → 403 `requires admin`.

Residual (new, Info): `callforge:` stays an alias rather than the canonical form, so if a real IdP
(EU/OpenAI clients) is wired later, keep the alias or migrate both sides together. Open on this
PR after cycle 204: F13 (Info), F14 (accepted), F17 (Info, alias retention). F12, F15, F16 closed.

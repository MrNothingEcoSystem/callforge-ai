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

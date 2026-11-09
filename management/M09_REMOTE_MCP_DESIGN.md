# M09 Production Remote MCP Server — Architecture Design (MCP-ENGINEER, planning only)

Verified 2026-11-09 against: MCP spec 2025-11-25 (current stable) + draft 2026-07-28 (RC, stateless, no sessions/GET stream), MCP Authorization (OAuth 2.1 draft-13, RFC8414/7591/8707/9728/9207), OpenAI Plugins docs (developers.openai.com/plugins/build/{mcp-server,auth}, /deploy/app-review), SEP-1488 securitySchemes, Tool Annotations (2025-03-26), Elicitation (2025-06-18).

## 1. Baseline (existing)

- core.mjs: stdio only, `McpServer` (@modelcontextprotocol/sdk ^1.0.0), 11 tools in tools/index.mjs, Zod schemas, SQLite (better-sqlite3), hash-linked audit (audit.mjs), dev bearer tokens cf_dev_ (auth.mjs, scopes simulate/read/write/admin, not enforced — requireScopes stub).
- server.mjs: plain REST simulation (/health,/ready,/simulate/*), no MCP/HTTP transport, wildcard CORS, no auth on simulate endpoints.
- M02 branch (oauth.mjs + server.mjs): OAuth2.1 auth-code+PKCE S256, HS256 JWT iss=callforge aud=callforge-api exp 15m, tenant derived ONLY from token, ROLES tenant_admin/operator/auditor, codes in-memory 10m single-use. Gaps vs spec: HS256 self-issued (not a real IdP), no RFC9728/8414 discovery, no RFC8707 resource/aud binding to canonical /mcp URI, no DCR/CIMD, no refresh, tenant_id still accepted by tools (must be removed).

## 2. Target architecture

```
ChatGPT/Codex/other MCP client
  | HTTPS, Authorization: Bearer <OAuth2.1 AT>
  v
Edge: TLS, Origin check (403), Mcp-Method/Mcp-Name header validation (2026-07-28),
      per-tenant+per-tool rate limit (429+Retry-After), body size/timeouts
  v
Remote MCP Server  POST /mcp  (Streamable HTTP, stateless per 2026-07-28;
                              backwards-compat: also accept 2025-11-25 sessions)
  |- AuthZ middleware: validate AT (iss/aud/exp, aud==canonical resource URI,
  |                    tenant_id+role+scope from token ONLY; ignore client tenant_id)
  |- Tool registry (owner-facing subset only, §4) + annotations + securitySchemes
  |- Service layer: existing store/audit logic, tenant-scoped queries
  |- Idempotency store (simulate_call), audit logger (hash chain)
  v
Authorization Server (external IdP recommended; M02 oauth.mjs only as dev stand-in)
  /.well-known/oauth-protected-resource[/mcp]  (RFC9728)
  /.well-known/oauth-authorization-server | /.well-known/openid-configuration (RFC8414/OIDC)
  /authorize (auth-code+PKCE S256, resource=RFC8707)  /token  /register (DCR RFC7591) or CIMD
```

Statelessness: no Mcp-Session-Id in 2026-07-28; if supporting 2025-11-25, mint session only for legacy clients, GET SSE + DELETE terminate, Last-Event-ID resumability optional. Do NOT implement deprecated HTTP+SSE (2024-11-05).
Protocol: POST single JSON-RPC req/notification per request, Accept: application/json+text/event-stream, reply JSON or request-scoped SSE, X-Accel-Buffering:no, close-on-cancel (no notifications/cancelled over HTTP — closing stream cancels). MCP-Protocol-Version header must match _meta or 400 HeaderMismatch; unknown version 400 UnsupportedProtocolVersionError; unknown method 404 -32601.
Server instructions ≤512 chars first (workflows + rate limits).

## 3. Endpoint inventory

| Method/Path                                                                                                                                                                                                                                                                | Auth            | Purpose                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /mcp                                                                                                                                                                                                                                                                  | Bearer OAuth2.1 | MCP endpoint (initialize/@2026: server/discover, tools/list, tools/call, ping)                                                                     |
| GET /mcp                                                                                                                                                                                                                                                                   | —               | 2026: 405; 2025-compat: SSE stream only                                                                                                            |
| DELETE /mcp                                                                                                                                                                                                                                                                | Bearer          | 2025-compat session terminate                                                                                                                      |
| GET /.well-known/oauth-protected-resource + /.well-known/oauth-protected-resource/mcp                                                                                                                                                                                      | none            | RFC9728: {resource:"https://<host>/mcp", authorization_servers:[issuer], scopes_supported:[...], resource_documentation}                           |
| GET /.well-known/oauth-authorization-server / openid-configuration                                                                                                                                                                                                         | none            | RFC8414/OIDC: issuer, authorization/token/registration endpoints, code_challenge_methods_supported:["S256"], client_id_metadata_document_supported |
| GET /authorize, POST /token, POST /register                                                                                                                                                                                                                                | PKCE/DCR        | OAuth2.1 flow (IdP-hosted in prod)                                                                                                                 |
| GET /health, /ready                                                                                                                                                                                                                                                        | none/internal   | ops only, not MCP                                                                                                                                  |
| 401: WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp", scope="<least-privilege>" (+ per-tool _meta["mcp/www_authenticate"] error payload for OpenAI tool-level linking UI — both metadata AND runtime error required). |

## 4. Tool mapping (11 → owner-facing families)

Confirmation levels: C0 auto (read-only), C1 confirm (additive write), C2 explicit confirm+elicitation (destructive/external), C3 never exposed.
Scopes (align M02 ROLES): callforge:read, callforge:simulate, callforge:config, callforge:report, callforge:audit, callforge:compliance.

| #   | Tool                  | Family           | Disposition                                                                                | Confirm                              | Annotations RO/Destr/Idemp/OpenWorld | securitySchemes                                      |
| --- | --------------------- | ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------ | ---------------------------------------------------- |
| 1   | onboard_tenant        | Onboarding       | EXPOSE as request_onboarding (no tenant creation by agent; creates pending request)        | C1                                   | F/F/F/F                              | oauth2 callforge:config                              |
| 2   | configure_business    | Business Config  | EXPOSE (own tenant only)                                                                   | C1 (C2 if license/dncr flags change) | F/F/T/F                              | oauth2 callforge:config                              |
| 3   | simulate_call         | Calls            | EXPOSE (sim-only until live provider; idempotency_key mandatory)                           | C1                                   | F/F/T/F* (*sim; T if live outbound)  | oauth2 callforge:simulate                            |
| 4   | simulate_conversation | Calls (fixtures) | EXPOSE read-only preview                                                                   | C0                                   | T/F/T/F                              | oauth2 callforge:read (or noauth if public fixtures) |
| 5   | check_readiness       | Readiness        | EXPOSE                                                                                     | C0                                   | T/F/T/F                              | oauth2 callforge:read                                |
| 6   | get_call_status       | Calls            | EXPOSE                                                                                     | C0                                   | T/F/T/F                              | oauth2 callforge:read                                |
| 7   | list_call_history     | Calls            | EXPOSE (paginated, PII-masked numbers)                                                     | C0                                   | T/F/T/F                              | oauth2 callforge:read                                |
| 8   | generate_report       | Reports          | EXPOSE                                                                                     | C0/C1 if exported                    | T/F/T/F                              | oauth2 callforge:report                              |
| 9   | access_audit_log      | Audit            | EXPOSE restricted (own tenant, auditor/tenant_admin only; NEVER verify_chain cross-tenant) | C0                                   | T/F/T/F                              | oauth2 callforge:audit                               |
| 10  | create_dev_token      | —                | DO NOT EXPOSE (C3) — dev/local only; prod rotation via IdP/admin console                   | —                                    | —                                    | —                                                    |
| 11  | validate_compliance   | Compliance       | EXPOSE (records evidence; gates dispatch)                                                  | C1                                   | F/F/T/F                              | oauth2 callforge:compliance                          |

New owner-facing wrappers to add (not in 11): get_my_profile (stable opaque id — OpenAI profile tool), request_live_call (C2, elicitation confirm, only post-M05), export_report (C1). Split validate_compliance evidence inputs from agent self-attestation: require source refs.
Every tool: explicit annotations (defaults are worst-case: destructive=true, openWorld=true — set false only if true), title, inputSchema/outputSchema (structuredContent), no tenant_id param (from token), pagination caps, PII redaction in logs.
Elicitation (2025-06-18; 2026-07-28 input_required+inputResponses): C2 tools return input_required with typed schema + requestState, resume on re-call; headless/no-elicitation clients get decline/cancel → no side effect. Annotations are hints only — server-side scope+tenant+confirmation enforcement is authoritative.

## 5. MUST NOT expose

create_dev_token, any secret/API-key creation or disclosure, tenant admin (other-tenant access, role grants, user provisioning, api_keys table), cross-tenant audit/verify_chain, raw auth.mjs dev tokens, provider secrets/webhooks (server.mjs /webhook/* stays disabled), debug endpoints. Also strip tenant_id from all tool schemas; reject mismatched tenant_id with 403.

## 6. Rate limiting & abuse

Edge: per-tenant + per-tool + per-IP token bucket; handshake/discovery endpoints separate generous bucket (avoid 429-on-connect loops). 429 + Retry-After + problem+json; document limits in server instructions (512-char lead). Expensive tools (generate_report, list_history, simulate_call) low quotas; idempotency keys dedupe retries. Origin validation, max body, timeouts, SSE keep-alive comments.

## 7. Conformance test plan

A. Protocol: initialize/discover negotiation, 400 HeaderMismatch/UnsupportedVersion, 404 -32601, POST-only (2026 GET/DELETE 405), Accept both types, SSE vs JSON replies, stream-close cancellation, legacy 2025 session flow if supported.
B. Discovery/OAuth: RFC9728 doc fields, RFC8414/OIDC docs + issuer match, WWW-Authenticate on 401, PKCE S256 enforced (no plain), code single-use/10m, RFC8707 resource on /authorize+/token and aud validation (token for other resource →401), DCR/CIMD, scope challenge 403 with WWW-Authenticate scope, _meta mcp/www_authenticate triggers OpenAI linking UI, no tokens in query/logs.
C. Authorization/tenant isolation: every tool with tenant_A token + tenant_B id → 403/no data; missing/expired/wrong-aud →401; scope matrix per §4; create_dev_token absent from tools/list.
D. Tools/annotations: tools/list matches §4 annotations+securitySchemes exactly (review gate), readOnly tools create no audit side-effects beyond logging, idempotent replay returns same call_intent_id, pagination bounds, output schema validation.
E. Confirmation: C1/C2 tools require elicitation accept; decline/cancel → no mutation + audit event; annotations alone never bypass server check (test by calling directly).
F. Rate limit/robustness: burst →429+Retry-After, Origin spoof →403, oversized body →413/400, OpenAI review checklist (annotations match behavior, destructive justification, no debug/PII in logs, test creds unexpired).
G. Interop: MCP Inspector + ChatGPT custom connector + Codex, both protocol versions.

## 8. Migration steps (M09 build order)

1. Upgrade SDK, add Streamable HTTP transport alongside stdio (keep stdio for local dev).
2. Swap M02 HS256 self-IdP → real IdP (or keep oauth.mjs behind flag for tests); add discovery docs, RFC8707 aud, DCR/CIMD.
3. Remove tenant_id params; enforce token-derived context; delete create_dev_token from remote registry.
4. Add annotations/securitySchemes/structured outputs; implement elicitation for C2.
5. Edge rate limiting + Origin + header validation; conformance suite (§7) in CI; OpenAI app-review pass.

## 8. Status update 2026-11-09 (post-M03-2)

M03-2 is MERGED on main (28c9040, 108/108, independently accepted). Security-relevant
surfaces that now exist and must feed the M09 build:

- Outbox dispatcher (M03-2) with HMAC-verified webhook ingress: 202/200/401/413/400
  semantics — reuse the same HMAC + size-limit patterns at the /mcp edge.
- Atomic quota (consume/release) now exists — M09 rate limits should reuse these
  counters per tenant+tool instead of inventing a new mechanism.
- Audit events are EXCLUDED from destructive retention (hash-chain integrity).
  Tool-surface audit rows must follow the same rule.

Blocking gates before /mcp ships:

1. SEC-001 real IdP (nothing network-exposed until then).
2. Issue #8: token-derived tenant context + scope enforcement on the MCP tool
   surface (requireScopes is still a no-op in tools/index.mjs).
3. Remove tenant_id from all tool schemas; 403 on mismatch.
4. RFC9728 discovery + RFC8707 aud binding to the canonical /mcp URI.

M09 remains design-only: no public endpoint, no deployment, no publication.

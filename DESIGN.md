# CALLFORGE v0.2 Design

## Runtime topology

The reconstructed baseline contains two local transports over one embedded store:

- `core.mjs`: stdio MCP server using the official MCP SDK.
- `server.mjs`: local HTTP development console/API.
- `tools/index.mjs`: 11 MCP schemas and handlers.
- `store.mjs`: SQLite schema, deterministic fixture seeding, and shared hashing helpers.
- `auth.mjs`: development bearer-token validation.
- `audit.mjs`: hash-linked audit event creation and verification.

## Security boundaries

- The product is simulation-only. No telephony adapter or live-call dispatch path exists.
- Development tokens are not production credentials.
- Tenant IDs are persisted and used in scoped queries, but M02 must replace model-supplied tenancy with authenticated server-derived context.
- Audit chaining detects mutation but does not provide immutable external anchoring.

## Data model

Core records are tenants, users, API keys, business configuration, knowledge entries, call intents, call events, audit events, and deterministic conversation fixtures. Call-intent idempotency is enforced by a unique `(tenant_id, idempotency_key)` index.

## Evolution path

M02 introduces OAuth/PKCE, RBAC, and server-derived tenancy. M03 replaces schema-only initialization with versioned migrations and durable workflow/outbox semantics. Later milestones add compliance evidence, approval, sandbox telephony, voice, integrations, console, and remote MCP transport.

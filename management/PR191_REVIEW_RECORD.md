# PR #191 — Review Record (issue #8: MCP tool-layer tenant + scopes)

Reviewer: CALLFORGE OMEGA dispatcher (self-review; `delegate_task` unavailable in the cron
runtime, as recorded in cycle 1). Date: 2026-11-26. Base: `cleanup/issues-2-4-5-6`
(stacked on PR #189). Reviewed head: the PR head at review time.

## Verdict: ACCEPT WITH FOLLOW-UPS

## Scope checked

`tools/toolAuth.mjs`, the guard wiring over all 11 tools, `validateAccessToken` scope
re-derivation, and `tests/mcp-tool-auth.test.mjs`. Full suite, eslint, prettier, tsc.

## Findings

| ID  | Severity                                    | Finding                                                                                                                                                                                                                        | Status                                                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| F1  | High (pre-existing, exposed by this change) | `configure_business` spreads every non-`tenant_id` argument into the `UPDATE ... SET` clause. Adding `access_token` to the schema would have emitted `SET access_token = ?` against a column `business_configs` does not have. | **Fixed** — the key is deleted from the update bag; regression test asserts a token-bearing config update persists. |
| F2  | High (pre-existing, previously untested)    | Same statement built `updated_at = datetime("now")` in JS template text; SQLite treats double quotes as identifiers, so the update branch threw `no such column: "now"` whenever a config row already existed.                 | **Fixed** — single quotes; covered by the same test.                                                                |
| F3  | Medium                                      | Default (no-token) mode is permissive, so existing stdio callers keep working while still reporting unauthenticated mode. Without `CALLFORGE_REQUIRE_TOOL_AUTH=1` the guarantee is advisory.                                   | By design; flagged for owner as a deployment-mode decision.                                                         |
| F4  | Low                                         | `access_token` is not stripped from other handlers' `args`, but only `configure_business` spreads args into SQL; others destructure known keys.                                                                                | No change.                                                                                                          |
| F5  | Low                                         | `validate_compliance` is mapped to `read` (it writes compliance evidence). Operator (`simulate`,`read`) can therefore write evidence.                                                                                          | Deliberate; revisit if evidence must be operator-attributed only.                                                   |

## Evidence

- `tests/mcp-tool-auth.test.mjs`: 9 tests — cross-tenant mismatch (403), missing scope
  (403), forged elevated scope claim (403 after role re-derivation), tampered signature
  (401), fail-closed without token (401), token-derived tenant, config update without
  column leak, audit scope acceptance.
- Local: 125 tests total, eslint 0, prettier clean, tsc clean.
- Known pre-existing flake: vitest worker SIGABRT in `better-sqlite3` statement destructor
  on roughly two of three full runs (`tests/tools.test.mjs` alone is always green).

## Merge posture

Draft, unmerged, stacked on #189 (merge #189 first). No deploy, live calls, or spend.
Issue #8 closes only after merge and an owner decision on retiring legacy no-token calls.

---

# Independent re-review — cycle 194 (2026-11-26, 14:10 UTC)

Reviewer: CALLFORGE OMEGA dispatcher, fresh isolated worktree `/tmp/cf-pr191` at head
`6e9a0e9`, base `28c9040`. Read-only audit first, then remediation. `delegate_task` is
still absent from the cron runtime, so "independent" here means a separate worktree and a
probe-driven audit rather than reuse of the authoring context.

## Verdict: ACCEPT WITH FOLLOW-UPS — 2 High defects found and fixed before merge readiness

## Findings

| ID  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                        |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **High** | `onboard_tenant` discarded the token-derived tenant and minted a random UUID. The presenting token is bound to its own tenant, so every follow-up call against the tenant it had just created returned 403 `Tenant mismatch`. Onboarding with a token was a dead end — a regression this PR introduced (before it, the client-supplied id was honoured). Probe: create tenant, then `check_readiness` → 403. | **Fixed** — the response now also returns a dev token scoped to the new tenant; covered by a test that onboards then calls `check_readiness`. |
| R2  | **High** | `create_dev_token` minted opaque `api_keys` tokens, but `authorizeTool` only called `validateAccessToken` (JWT). A token produced by this server's own tool surface was rejected at 401 `Invalid token signature`. Probe: `validateAccessToken(devToken)` → invalid.                                                                                                                                         | **Fixed** — the authorizer now falls back to `authMiddleware.validateDevToken`; 3 tests (accept, cross-tenant 403, missing scope 403).        |
| R3  | Medium   | Unknown or absent `role` on a token skipped scope re-derivation entirely (`roleScopes ? filter : claimed`), so a forged `superadmin` role with `scope:['admin','audit']` was granted both while the comment claimed a role could never carry a scope it does not hold.                                                                                                                                       | **Fixed** — fail closed (no role, no scopes); test added.                                                                                     |
| R4  | Low      | `simulate_conversation` derives `tenant_id` from the token but the handler ignores it (fixtures are global).                                                                                                                                                                                                                                                                                                 | Documented, no change.                                                                                                                        |
| R5  | Low      | `args.access_token` takes precedence over `CALLFORGE_ACCESS_TOKEN`. Intended for multi-tenant stdio clients but means a misconfigured caller silently outranks the server default.                                                                                                                                                                                                                           | Documented, no change.                                                                                                                        |
| R6  | Low      | `validate_compliance` writes evidence but is gated on `read`.                                                                                                                                                                                                                                                                                                                                                | Unchanged, owner decision (as before).                                                                                                        |
| R7  | Low      | If the token is well-formed but not a JWT and no `devTokens` validator is injected, the error surfaced is a signature error rather than "unsupported credential".                                                                                                                                                                                                                                            | Documented.                                                                                                                                   |

## Evidence after remediation

- `tests/mcp-tool-auth.test.mjs`: 14 tests (9 prior + 5 new), all green in isolation.
- Every other test file green in isolation; 130 tests exist in total. Full parallel runs still
  hit the pre-existing `better-sqlite3` 11.10 destructor SIGABRT (`Statement::~Statement`,
  `# Assertion failed: (env) != nullptr`) on a random worker — 109-122 of 130 execute, no test
  fails. Not introduced here; CI is the gate.
- eslint 0, prettier clean, tsc clean.

## Residual merge conditions

Unchanged: merge #189 first, then this. Draft until owner merge. `Emit onboarding credential`
is additive to the response shape; a future owner decision on retiring unauthenticated calls
still stands.

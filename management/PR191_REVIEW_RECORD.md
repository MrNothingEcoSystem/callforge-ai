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

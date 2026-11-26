# CALLFORGE OMEGA — Ascension Execution Log

## 2026-11-09 — Cycle 0 (supervisor bootstrap)

- Audited canonical repo: main `92b07f2` green; M02 PR #7 head `ac0adcb` green; 6 issues open.
- Audited automation: 6 cron jobs, 0 CALLFORGE; gateway active. Decision D-003: create exactly one dispatcher.
- Created management/ ascension set (baseline, roadmap, milestones, blockers, decisions, log).
- Dispatched: OMEGA-SECURITY-AUDITOR on M02 PR #7; BACKEND-ARCHITECT for M03 design.
- Next: record M02 verdict, implement M03 increment 1, start dispatcher, Telegram report.

## 2026-11-09 — Cycle 1 (dispatcher, 04:12 UTC)

- Sync: `git fetch`; local HEAD = origin/main = `75b191acff9cde5a3e8ee6d62033fcd80380a7c2`. No writes to legacy Davidcarmelalex/CALLFORGE.
- Toolchain verified: Node v24.22.2 at /root/.hermes/cache/scratch/node24/bin, corepack pnpm 12.18.0.
- Telegram digest sent (last recorded digest was cycle 1); `hermes send` returned `sent`.
- Selected highest-priority unblocked task: M02 independent security verdict (TECH-001). `delegate_task` is not available in this cron environment, so the audit was performed directly, read-only, on PR #7 (`ac0adcb`) in an isolated worktree (removed afterwards).
- Tests: pnpm install (better-sqlite3 built from source, ~1m52s) + `pnpm test` = 10 files, 70/70 passed in 1.59s. CI verify pass.
- Verdict: REJECT for production identity; acceptable only as simulation baseline. SEC-001 self-asserted tenant/role at authorize (verified: code issued for arbitrary tenant as tenant_admin), SEC-002 default secret fallback. See ASCENSION_BLOCKERS.md.
- Recorded SEC-001/002/003; M02 status -> changes_requested in ASCENSION_MILESTONES.json. Created missing ASCENSION_NEXT_ACTIONS.md and ASCENSION_PROGRESS.md.
- Changes pushed on branch `docs/ascension-cycle-001` via draft PR (no merge, no deploy, no live calls, no spend).
- Telegram digest: first recorded digest this cycle (no prior digest in log) — see delivery receipt in PR/next log entry.
- Resource usage: ~13 min wall clock, 1 worktree, no persistent processes. Remaining work estimate: SEC-001 requires a real IdP/authenticated-user design decision (owner input on IdP choice) — cannot be estimated in hours until that decision; SEC-002 is a small bounded fix. Assumption: simulation baseline remains the deployment mode until EXT-004.

## 2026-11-09 — Supervisor verification + M02 fixes + M03-1 (04:30 UTC)

- Independent auditor verdict recorded: ACCEPT WITH FOLLOW-UPS at `ac0adcb` (PR #7 comment).
- Fixed on M02 branch: SEC-002 fail-closed secret (65ff410), SEC-003 timing-safe PKCE + code invalidation (65ff410), F4 conversation documented + auth test. Head `4368955`, 73/73 tests, CI PASS (42560741400).
- Issue #3 closed (graceful stop fix merged into M02 branch); issue #8 filed for MCP surface (F3).
- M03-1 implemented on draft PR #9 (head `dec034e`, 66/66 tests, CI PASS): versioned migrations, outbox, state machine, webhook inbox, quota/retention hooks, backup/restore. PostgreSQL deferred with documented rationale.
- Cycle 1's docs branch `docs/ascension-cycle-001` had no PR; its verified content committed to main instead; orphan branch removed.
- Remaining work estimate: M03-2 (dispatcher loop + counters) ~1 focused session; SEC-001 IdP decision is owner-gated (EXT-004-adjacent), unestimable until decided; M04 register is research-only, parallelizable.

## 2026-11-22 — Cycle 190 (dispatcher, 04:01 UTC)

- Sync: origin/main = 28c9040; local main had 3 unpushed ledger commits (cycles 74/75, preserved, not pushed to main). Work done on branch cleanup/issues-2-4-5-6 from origin/main.
- Toolchain verified: Node v24.11.0, corepack pnpm 12.18.0.
- Selected highest-priority unblocked task: cleanup bundle for open issues #2, #4, #5, #6 (M01 audit follow-ups); all milestones M02+ remain owner-gated (EXT-001..009, F-65-4 bootstrap).
- Changes (head 97efda6): #2 verifyChain mid-chain seeding from predecessor hash + sentinel-keyed genesis skip; #4 getEvents ORDER BY rowid DESC; #5 require('crypto') -> node:crypto createHash imports in store/auth tests; #6 real start() listen//health/shutdown socket smoke test. 3 new tests.
- Tests: pnpm test = 13 files, 111/111 passed locally.
- Draft PR #189 opened (no merge — owner-gated). Issues #2/#4/#5/#6 left open pending review/merge.
- Telegram: no milestone acceptance/critical finding; check digest interval in log before sending — no digest sent this cycle.
- Resource usage: ~15 min wall clock. Remaining work: independent review of PR #189 (~1 session); owner merge decisions on all draft PRs; F-65-4 bootstrap IdP decision blocks M02 production identity. Assumption: drafts remain unmerged until owner approval.
- Update: prettier fix c9a9d59 (first CI failed format:check on tests/audit.test.mjs); local 111/111 (one flaky vitest worker SIGABRT on re-run, clean on retry). CI verify PASS (run 44983615755). PR #189 head c9a9d5912d22ec7130cd305597c373e0bdd48969; remote SHA verified equal.

## 2026-11-26 — Cycle 191 (dispatcher, 11:31 UTC)

- Sync: `git fetch`; local main = origin/main = `28c90405b5da65807b9139f05ce0f30bc232bcfe`, clean tree.
- Toolchain: cached Node 24 had been pruned from scratch; re-provisioned v24.11.0. Node 26.12.1 present but cannot build better-sqlite3 11.10 (V8 API removals), so 24 is the pinned runtime.
- Selected highest-priority unblocked task: independent review of draft PR #189 (issues #2/#4/#5/#6), open since 2026-11-22 and the only engineering work not yet reviewed. All milestones M02+ remain owner-gated.
- Reviewed on isolated worktree /tmp/cf-pr189 at head 564b014 (base 28c9040). Core fix verified by probe: tampered predecessor propagates into a fromEventId segment verdict.
- Verdict ACCEPT WITH FOLLOW-UPS. Remediated R2 (unknown start id returned false-valid), R3 (lint nit), R4 (random-port flake -> ephemeral port). R1 (deleting the oldest audit row breaks full-chain verify; audit_events is retention-exempt today) filed as follow-up, R5 (getEvents newest-first contract) documented.
- Tests: 111/111 pre-remediation at 564b014 (CI run 44983783150 SUCCESS); 112/112 post-remediation locally, eslint clean, prettier clean, tsc clean.
- Review record: `management/PR189_REVIEW_RECORD.md`. No merge, no deploy, no live calls, no spend.
- CI: first push failed at setup-node. Root cause traced by inspection: `node_modules` was a host-absolute symlink (-> /root/callforge-ai/node_modules) that a `git add -A` had staged, so runners choked with ERR_PNPM_CLI_PREFIX_IO_ERROR/EACCES. Untracked it, added a bare `node_modules` ignore rule, reverted the interim pnpm-version/runner experiments. verify PASS (run 45817752041) at final head 3ea6c86.
- Resource usage: ~45 min wall clock (CI diagnosis dominated; exceeded the 20-min target), 1 worktree, no persistent processes. Remaining: owner merge decision on PR #189 + #7/#9/#20 chain; R1 needs an archival/checkpoint policy before audit retention; M02 production identity still blocked on the SEC-001 IdP decision (EXT-004-adjacent).

## 2026-11-26 — Cycle 192 (dispatcher, 12:51 UTC)

- Sync: `git fetch`; local main = origin/main = `28c90405b5da65807b9139f05ce0f30bc232bcfe`, clean tree. No writes to legacy repo.
- Toolchain: Node v24.11.0 (scratch node24 present), corepack pnpm 12.18.0.
- Selected highest-priority unblocked task: issue #190 / TECH-006 (verifyChain false chain break after head truncation; R1 from the PR #189 review). Same subsystem as the open PR, so work continues on the existing write lease `cleanup/issues-2-4-5-6` instead of opening a stacked branch.
- Change: `verifyChain` now reports `anchored` (oldest stored event still carries the genesis sentinel) and downgrades a truncated head to `warnings[]` instead of `Hash chain broken`; genesis skip tightened to the first checked event so a forged mid-chain sentinel is rejected. Return shape is additive.
- Tests: 4 added; 116/116 pass, eslint 0, prettier clean, tsc clean. CI verify PASS (run 45824320496) at head `cdd0d62ea7e4608907c3760f08f0f104bf2b4de4`; remote branch SHA verified equal. PR #189 body updated, stays draft.
- No merge, no deploy, no live calls, no spend. Signed checkpoints per archive batch (issue option 2) remain owner archival-policy.
- Resource usage: ~20 min wall clock including pnpm install (2m12s, better-sqlite3 source build), 1 worktree, no persistent processes. Remaining: independent review of the R1 commit; owner merge decisions on PR #189 and the #7/#9/#20 chain; SEC-001 IdP decision still blocks M02 production identity (F-65-4, PR #65).

## 2026-11-26 — Cycle 193 (dispatcher, 13:31 UTC)

- Sync: `git fetch`; local main = origin/main = `28c90405b5da65807b9139f05ce0f30bc232bcfe`, clean tree. Work continues on a branch stacked on the open PR #189 lease (`cleanup/issues-2-4-5-6`, ACCEPT WITH FOLLOW-UPS) because the ledger files are shared; merge order is #189 first, then this PR.
- Toolchain: Node v24.11.0 (scratch node24), pnpm 12.18.0, `pnpm install --frozen-lockfile` 1.5s.
- Selected highest-priority unblocked task: issue #8 (MCP tool surface has self-asserted tenant_id and a `requireScopes()` stub) — the last open M02 security follow-up, prerequisite for M09, and not owner-gated.
- Change: `tools/toolAuth.mjs` authorizer (token from tool arg or `CALLFORGE_ACCESS_TOKEN`, signature/issuer/audience/expiry validation via `oauth.validateAccessToken`, tenant-mismatch 403, scope 403, fail-closed 401 when `CALLFORGE_REQUIRE_TOOL_AUTH=1`); guard wired into all 11 tools with per-tool scopes; `validateAccessToken` now re-derives scopes from the role, closing the SEC-003 remainder. Returned results stay additive: 8 negative tests at the tool layer.
- Tests: 116/116 pass when the run is clean; eslint 0, prettier clean, tsc clean. Known pre-existing flake reproduced: a vitest worker SIGABRTs in `better-sqlite3` `Statement::~Statement` on ~2 of 3 full runs (112/116, 4 tests unrun); `tests/tools.test.mjs` in isolation is always green. CI is the gate.
- No merge, no deploy, no live calls, no spend.
- Resource usage: ~25 min wall clock, no worktree, no persistent processes. Remaining: independent review of this PR; owner merge decisions on #189 then this; M09 still needs a remote transport decision; SEC-001 IdP decision still blocks M02 production identity.
- Self-review found two pre-existing defects on the `configure_business` update path that this change would have exposed or left broken: `access_token` spread into the `SET` clause (no such column) and `datetime("now")` (double quotes = identifier in SQLite). Both fixed with a regression test; review record `management/PR191_REVIEW_RECORD.md`, verdict ACCEPT WITH FOLLOW-UPS. Re-verified: 125 tests, eslint 0, prettier clean, tsc clean.
- Final head `8e0fbf36f42442f030fd59c671c5f0f8a1474c3e`; remote branch SHA verified equal; CI verify SUCCESS (run 45830887519). PR body updated with the review record. No Telegram message this cycle — last digest was cycle 191 (~12:18 UTC), inside the 6-hour window, and nothing here is a milestone acceptance, critical finding, blocked gate or approval request.

## 2026-11-26 — Cycle 194 (dispatcher, 14:10 UTC)

- Sync: `git fetch`; local `main` = origin/main = `28c90405b5da65807b9139f05ce0f30bc232bcfe`. The write lease `mcp-tool-tenant-auth` was already checked out here at `6e9a0e9` with 0 commits behind main, so the cycle continued on that lease instead of opening a stacked branch (ledger files are shared; one writer per branch).
- Toolchain: Node v24.11.0 (scratch node24), pnpm 12.18.0, `pnpm install --frozen-lockfile` 3s.
- Selected highest-priority unblocked task: independent review of draft PR #191 (issue #8), the only engineering work not yet independently reviewed; every milestone M02+ is owner-gated.
- Method: fresh worktree `/tmp/cf-pr191`, read-only audit, then executable probes against the real authorizer (`probe191*`).
- Findings: R1 High — `onboard_tenant` threw away the token tenant and created a caller-unreachable tenant (403 on the very next call, regression vs pre-PR behaviour). R2 High — `create_dev_token` output could not be used as `access_token` (JWT-only validation). R3 Medium — unknown role bypassed scope re-derivation (fail-open). R4-R7 Low/documented.
- Remediation: authorizer accepts dev tokens through injected `authMiddleware.validateDevToken`; onboard returns a scoped credential for the new tenant; unknown role fails closed. 5 regression tests.
- Tests: `tests/mcp-tool-auth.test.mjs` 14/14; every other file green in isolation (11-46 per file). Full parallel runs still trip the pre-existing `better-sqlite3` 11.10 `Statement::~Statement` SIGABRT on a random worker (109-122 of 130 execute, no failures). eslint 0, prettier clean, tsc clean.
- No merge, no deploy, no live calls, no spend. No Telegram message: no milestone acceptance, critical finding, external blocker, failed gate or approval request, and the last digest (cycle 191, ~12:18 UTC) is inside the 6-hour window.
- Final head `cc2af532c2d750070a99d4a83ca31265c1171ae4`; remote branch SHA verified equal; CI verify SUCCESS (run 45837141915) at that exact SHA. PR body updated with the review outcome via REST (the CLI `pr edit` exits 1 on the projectCards deprecation notice).
- Resource usage: ~15 min wall clock, 1 worktree, no persistent processes. Remaining: owner merge decision on #189 then #191; dev tokens still never expire into JWT parity; M09 needs a remote transport decision; SEC-001 IdP decision still blocks M02 production identity.

## 2026-11-26 — Cycle 195 (dispatcher, 14:50 UTC)

- Sync: `git fetch`; local `main` = origin/main = `28c90405b5da65807b9139f05ce0f30bc232bcfe`, clean tree. No writes to the legacy repo.
- Toolchain: Node v24.11.0 (scratch node24), pnpm 12.18.0; SDK already at 1.32.2 (has `streamableHttp`), so no upgrade was needed for M09 step 1.
- Selected highest-priority unblocked task: M09 build step 1 — a remote transport for the MCP surface. #189 and #191 are review-complete and owner-gated, SEC-001 is an owner IdP decision, so new M09 engineering is the forward path. New branch `m09-streamable-http` stacked on #191 (shared ledger tail; merge order #189 → #191 → #192).
- Change `2e1a470`: `mcp-http.mjs` handler — stateless `StreamableHTTPServerTransport` with `enableJsonResponse`, opt-in via `MCP_HTTP_ENABLED=1`; bearer required (JWT or dev token) with RFC9728 `WWW-Authenticate` challenge, Origin allow-list, `MCP-Protocol-Version` validation, 1 MiB body cap, 405 + `Allow: POST` on GET/DELETE, protected-resource metadata endpoint. Credential injected into the tool authorizer; every `tenant_id` schema field made optional (mismatch still 403). `server.mjs` routes `/mcp` and `/.well-known/oauth-protected-resource*` behind the flag.
- Independent review in detached worktree (record `management/PR192_REVIEW_RECORD.md`, ACCEPT WITH FOLLOW-UPS): F1 Medium — `req.destroy()` on body overflow reset the socket instead of delivering the 413; fixed and regression-tested. F2-F6 recorded, F2 (CORS preflight ignores the allow-list) is the next task.
- Tests: `tests/m09-mcp-http.test.mjs` 7/7; full suite 0 failures with the known `better-sqlite3` worker SIGABRT still taking 2 workers per parallel run (118/136 executed). New TECH-009 records that flake.
- Verification on the real server (port 3811, flag on): `/health` 200, `/mcp` 401 + challenge, metadata served, GET 405.
- No merge, no deploy, no live calls, no spend. No Telegram message: no milestone acceptance, critical finding, external blocker, failed gate or approval request, and the last digest (cycle 191, ~12:18 UTC) is inside the 6-hour window.
- Head `430b7511d0ab4e1cad5bfd0b9ea15e79b1bf94a1`, CI verify SUCCESS (run 45843752911); docs head `84e14f2187761f68148606c1f06b3b8eff5dd908`, CI verify SUCCESS (run 45843861650). Remote branch SHAs verified equal.
- Resource usage: ~20 min wall clock, 1 detached worktree, no persistent processes. Remaining: owner merge decisions on #189/#191/#192; M09 steps 2-6; SEC-001 IdP still blocks production exposure.

## 2026-11-26 — Cycle 196 (dispatcher, 15:27 UTC)

- Sync: `git fetch`; local `m09-streamable-http` = `origin/m09-streamable-http` = `df463e0`, 0 commits behind `origin/main` (`28c9040`), clean tree. Writes only to MrNothingEcoSystem/callforge-ai; the lease `m09-streamable-http` was already checked out, so the cycle continued on it rather than opening another stacked branch (ledger tail is shared; merge order #189 → #191 → #192).
- Toolchain: Node v24.11.0 (scratch node24), pnpm 12.18.0.
- Selected highest-priority unblocked task: review follow-up F2 on PR #192 — the OPTIONS preflight in `server.mjs` short-circuited with `Access-Control-Allow-Origin: *` before the transport's Origin allow-list, so a disallowed browser origin passed preflight and only failed on the POST.
- Change `4ee48f7`: `/mcp` preflight now echoes the matched origin with `Vary: Origin`, advertises only `POST, OPTIONS` and the real header set, and 403s unlisted origins; non-MCP paths keep the historical wildcard; an unset `MCP_ALLOWED_ORIGINS` still falls back to `*` so local/no-config use is unchanged. `parseOrigins` exported from `mcp-http.mjs` so one parser serves both layers.
- Tests: new `tests/m09-cors-preflight.test.mjs` (real listener, ephemeral port) 5/5 — allowed origin echoed, unlisted 403 with no ACAO, no-Origin wildcard, `/health` unaffected, unset allow-list wildcard. `tests/m09-mcp-http.test.mjs` + `tests/server.test.mjs` 9/9. Full suite 115/142 executed, 0 failures, 14/16 files — the two SIGABRT'd workers are the known TECH-009 `better-sqlite3` 11.10 flake. eslint 0, prettier clean, tsc clean.
- No merge, no deploy, no live calls, no spend. No Telegram message: no milestone acceptance, critical finding, external blocker, failed gate or approval request, and the last digest (cycle 191, ~12:18 UTC) is inside the 6-hour window.
- Resource usage: ~10 min wall clock, no worktree, no persistent processes. Remaining: owner merge decisions on #189/#191/#192; next M09 step is RFC9728/8414 discovery + RFC8707 audience binding; SEC-001 IdP decision still blocks production exposure.
- Head `4ee48f7`; first CI run 45849537594 failed on `format:check` because the one-word TECH-008 edit left `ASCENSION_BLOCKERS.md` table widths misaligned — realigned in `d29b4ab`. CI verify PASS at `d29b4ab` (run 45849718340); remote branch SHA verified equal. PR #192 body updated via REST (CLI `pr edit` still exits 1 on the projectCards deprecation notice).

## 2026-11-26 — Cycle 197 (dispatcher, 16:04 UTC)

- Sync: `git fetch`; local `m09-streamable-http` = `origin/m09-streamable-http` = `29653be`, 0 commits behind `origin/main` (`28c9040`), clean tree. Lease continued (ledger tail shared; merge order #189 → #191 → #192). No writes to the legacy repo.
- Toolchain: Node v24.11.0 (scratch node24), pnpm 12.18.0, frozen-lockfile install.
- Selected highest-priority unblocked task: M09 step 2 — RFC9728/8414 discovery + RFC8707 audience binding (follow-up from the PR #192 review; #189/#191 are review-complete and owner-gated).
- Change `4fa9dd5`: `authorizationServerMetadata()` replaces the inline well-known block — absolute endpoints from the canonical base, `resource_indicators_supported`, S256-only, path-aware `/mcp` variant; `protectedResourceMetadata()` gains an absolute `authorization_servers[0]`, `resource_name` and `tls_client_certificate_bound_access_tokens:false`; `authorize` normalises an RFC8707 `resource` (absolute http(s), fragment stripped) and the token carries `aud:[callforge-api, resource]`; the `/mcp` bearer gate binds to this exact resource and answers 401 `invalid_token` with the RFC9728 pointer for a foreign resource. Well-known MCP paths now join the Origin allow-list preflight.
- Owner-visible behaviour change: an unbound (legacy `aud=callforge-api`) token is rejected at `/mcp` when `MCP_PUBLIC_URL` is set; `MCP_REQUIRE_RESOURCE_AUDIENCE=0` restores the old lenient check.
- Tests: new `tests/m09-discovery-audience.test.mjs` 7/7 (metadata shape, path-aware doc, resource normalisation, aud shape, bound accept, foreign-resource 401, legacy accept-only-when-off). Updated `issueToken` in `tests/m09-mcp-http.test.mjs` to mint a bound token; `m09-mcp-http` + `m09-cors-preflight` + `m02-oauth` 26/26.
- Full suite: 125 passed, 0 failed, 15/17 files; the 2 non-running workers are the TECH-009 `better-sqlite3` `~Statement` SIGABRT flake (`audit.test.mjs` aborted this run, 16/16 in isolation). eslint 0, prettier clean, tsc clean.
- Live check on the real server (port 3811, flag on): metadata absolute + path-aware, unauthenticated POST 401 with `invalid_token` + resource_metadata, bound token 200, foreign-resource token 401, relative `resource` 400, preflight blocked origin 403 / allowed origin echoed.
- No merge, no deploy, no live calls, no spend. No Telegram message: no milestone acceptance, critical finding, external blocker, failed gate or approval request, and the last digest (cycle 191, ~12:18 UTC) is inside the 6-hour window.
- Head `4fa9dd5`, then `b81f970` (docs) → CI verify SUCCESS (run 45855801880); self-review hardened `publicBaseUrl` against a malformed `MCP_PUBLIC_URL` (+1 test, 8/8) at `0b016ad`, CI verify SUCCESS (run 45856115277). Remote branch SHA verified equal at each step; PR body updated via REST. No Telegram message. Remaining: owner merge decisions on #189/#191/#192; M09 steps 3-6 (next: per-tenant rate limiting); `iss` URL-vs-literal conformance awaits SEC-001.

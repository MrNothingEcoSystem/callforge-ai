# TECH-013 F6/F7 — import-cycle split review record

- Cycle: 226 (dispatcher, 2026-11-27)
- PR: #202 (`tech-015-dial-sink`, stacked on #201 → #200 → #199 → #198 → #197)
- Head under review: `ccc7a4b` — `refactor(policies): move statutory defaults to a neutral module`
- Base at intake: `15f0a44`; `origin/main` = `28c9040` (unchanged, 0 behind)
- Reviewer: same-cycle independent read-only pass in a detached worktree
  (`/root/.hermes/cache/scratch/wt-review226`), symlinked `node_modules`, no writes outside
  its own record

## Scope

Follow-ups F6 and F7 from `management/TECH013_REVIEW_RECORD.md`:

- F6 — `policies/dialEligibility.mjs` and `policies/tenantPolicy.mjs` imported each other. It
  worked only because every cross-reference was deferred to call time; a future top-level use
  would have hit a TDZ error.
- F7 — `POLICY_DEFAULTS` was shallow-frozen and `readTenantPolicy` shallow-copied it, so a
  caller mutating `options.callingWindow` mutated the module default.

## Change

New neutral `policies/policyDefaults.mjs` owns `DEFAULT_TIME_ZONE`, `CALLING_WINDOW`,
`RETRY_LIMITS`, `DNCR_MAX_AGE_HOURS` and `POLICY_DEFAULTS`. Both nested objects and the
defaults are frozen; `copyPolicyDefaults()` returns a structurally independent copy.
`dialEligibility.mjs` imports from it and re-exports `POLICY_DEFAULTS` so existing call sites
and tests keep one address; `tenantPolicy.mjs` imports from it and uses the copy helper. The
only remaining edge is `dialEligibility → tenantPolicy` (`validatePolicyOptions`), now a DAG.

## Verification (reproduced by the reviewer, not read from the author's report)

- `pnpm vitest run --pool=threads`: 20 files, **214/214** passed, exit 0.
- Dynamic import probe: `tenantPolicy.mjs` evaluates at top level and loads
  `POLICY_DEFAULTS`/`copyPolicyDefaults`; importing both modules yields the _same_ frozen
  defaults object from `dialEligibility.POLICY_DEFAULTS` — the re-export is real, not a second
  copy, so a divergence cannot hide.
- Static check: `grep '^import'` shows no `tenantPolicy → dialEligibility` edge.
- `eslint` 0, `tsc --noEmit` 0, `prettier --check .` clean at the review head.
- Behaviour neutrality: the diff only relocates constants and swaps `{ ...POLICY_DEFAULTS }`
  for `copyPolicyDefaults()` (same keys, same values); no evaluator branch changed.
- CI `verify` on `ccc7a4b`: run 45987017732 SUCCESS.

## Verdict: ACCEPT

F6 and F7 are closed. Assumption recorded: the re-export is deliberately kept for
compatibility and can be dropped once the in-repo call sites import `policyDefaults.mjs`
directly; that is cosmetic, not a defect.

Residual, unchanged and non-blocking on this track: F2 half-hour windows and the
territory/penalty sign-off need EXT-002; a real DNCR provider needs EXT-003; list/delete
policy routes and last-write-wins on concurrent PUTs remain open.

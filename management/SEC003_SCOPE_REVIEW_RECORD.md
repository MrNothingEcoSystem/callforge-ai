# SEC-003 F2 — scope re-derivation at token validation (PR #212)

- Date: 2026-11-27, cycle 236
- Branch `m02-authorize-auth-recover`, head `89af926`, base `main` 28c9040
- Reviewer: cycle-run probe, **not** a delegated independent auditor (labelled as such)

## Change

`validateAccessToken` no longer trusts the `scope` claim. It requires a known `role`, then
intersects the claimed scopes with `ROLES[role]`. An absent claim derives the full role grant; an
explicit empty claim grants nothing; an unknown/absent role invalidates the token.

## Verdict: ACCEPT

5 tests added (`tests/m02-oauth.test.mjs`), **all 5 fail on the pre-fix handler** and pass after:

- over-scoped token (`role: auditor`, `scope: ['read','admin','simulate']`) → context scopes
  `['read']`, so `admin`/`simulate` are refused;
- no scope claim → full role grant (`['read','audit']`) instead of the previous empty set;
- explicit empty claim → no grant;
- unknown role (`superuser`) → `valid: false`, `Token has unknown role`;
- end to end: `POST /simulate/call` with that over-scoped token returns **403** at the guard,
  where pre-fix it reached the handler.

Gates on the branch: **118/118**, tsc 0, eslint 0, prettier clean, CI `verify` PASS
(run 46048412891). Nothing here widens a grant: the intersection is a subset of both the claim
and the role.

## F-order follow-ups

- F1: the role list stays a static table in `oauth.mjs`; when a real IdP issues roles
  (SEC-001) this must map IdP roles/groups instead of accepting ours.
- F2: `sub` is still `record.tenant_id`, so there is no per-user subject until the IdP step.

## Process finding: orphaned commits on a merged PR

PR #7 was merged on **2026-11-09** at `4368955`; the branch was then used for three more fixes
(`c2a155f`, `7d8671f`, `7ce247f`) plus this one, so none of that work was ever on `main` and no PR
existed for it. All four are cherry-picked onto `89af926` off `main` — **#212 is the reviewable
home for M02 identity work; `m02-oauth-tenant-isolation` is superseded.**

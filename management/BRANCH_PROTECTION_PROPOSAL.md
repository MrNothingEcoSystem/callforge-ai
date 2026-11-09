# CALLFORGE — GitHub Main Branch-Protection Proposal (FOR APPROVAL — NOT APPLIED)

Date: 2026-11-09. `main` is currently UNPROTECTED (verified via API: 404 on the
branch-protection endpoint). This proposal defines the settings to apply once the
owners explicitly authorize. Nothing here has been changed.

## Proposed settings for `main`

1. Require a pull request before merging (dismiss stale approvals on new pushes).
2. Required approvals: 1 (2 for `server.mjs`, `oauth.mjs`, `workflow/*`, `mcp.mjs`
   paths once CODEOWNERS exists).
3. Require status checks to pass: `verify`, and require branches to be up to date / mergeable clean.
4. Required conversation resolution before merge.
5. Restrict who can push to matching branches: PR merges only (no direct pushes).
6. Prevent force pushes; block branch deletion.
7. Enforce for admins: enabled (with break-glass account access confirmed first).

## Impact and trade-offs

- All merges (including dispatcher's) must open PRs with green CI + approval.
- Draft PRs cannot merge (GitHub default) — the current draft workflow stays compatible.
- If a repository ruleset is preferred over legacy protection, apply the same
  rules as a branch ruleset for `main`.

## Authorization needed

- [ ] Owner approval of settings above
- [ ] Confirmation of break-glass admin access
- [ ] Apply via GitHub UI/API in a follow-up step, then verify with the API that
      `GET /branches/main/protection` returns the rules.

## Risks if not applied

Autonomous merges continue without enforced review — any future auto-merge
misconfiguration could land unreviewed code on main unchanged.

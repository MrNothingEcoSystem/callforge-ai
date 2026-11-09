# CALLFORGE — SEC-001 Owner Decision Package (Production Identity Provider)

Date: 2026-11-09. Status: DECISION REQUIRED from the owners (User, Chettai, Bishop).
Current state: simulation baseline only — `oauth.mjs` is a self-issued HS256
simulated IdP. SEC-001: `/oauth/authorize` lets any caller mint `tenant_admin`
for any tenant (unauthenticated). Remains OPEN by owner directive.

## Options

### Option A — Managed external IdP (e.g., Auth0, Okta, Azure AD B2C)

- Tokens: RS256/JWKS, standard OIDC + OAuth 2.1 Authorization Code + PKCE, refresh, revocation.
- Engineering: swap `oauth.mjs` for OIDC discovery + JWKS validation; tenant/role/scope
  mapped from token claims; M02 RBAC structures survive unchanged.
- Data residency: choose a region (EU/UAE PoP) — check vendor DPA; UAE PDPL
  cross-border transfer rules apply to tenant PII. LEGAL-REVIEW on data residency + DPA.
- Cost: SaaS pricing; vendor lock-in moderate (standard OIDC, low migration cost).
- Risk: production-grade crypto/auth, DoS managed by vendor. Lowest engineering risk.

### Option B — Self-hosted open-source IdP (e.g., Keycloak, ZITADEL)

- Tokens: RS256/JWKS, full control; deploy in UAE region (residency-friendly).
- Engineering: operate + patch the IdP, configure realm/tenant mappings, expose OIDC
  endpoints, integrate with our `guard()`; ongoing SRE burden.
- Cost: infra + operations; no per-token license.
- Risk: secure self-hosting is nontrivial (key rotation, abuse, availability, audit).

### Option C — Bespoke OAuth provider (current simulation code, productized)

- Engineering: hardest; re-implementing F1/F5/F6-grade auth primitives is a security
  research project. Rejected unless the owners accept that risk explicitly.

## Recommendation

Option A for the first production identity. Rationale: it retires the exact SEC-001 class
of defects (unauthenticated authorize, HS256-only, no revocation) with the least new
attack surface, and migration is standard-OIDC so an Option B move remains possible.
Option B is preferred only if UAE data-residency constraints rule out managed vendors.

## Implementation consequences (either A/B)

1. Replace `oauth.mjs` sign/verify with OIDC/JWKS; keep interface (`authenticate`,
   `authorizeScopes`) so `server.mjs` and `mcp.mjs` change minimally.
2. RFC9728 discovery already exposed for /mcp (M09); point `authorization_servers`
   at the real IdP; add RFC8707 `aud` binding to the canonical /mcp URI.
3. Role/scope claims → our RBAC ceiling logic (M02). Refresh + revocation wiring.
4. Tenant provisioning flow (invite/SSO) replaces `create_dev_token` flows.
5. Re-run the M02 independent audit against the real IdP before any network exposure.

## UAE data-residency considerations (LEGAL-REVIEW)

- PDPL (Federal Decree-Law 45/2021) cross-border transfers of tenant PII.
- Free-zone regimes (DIFC/ADGM) differ where applicable.
- TDRA verification ("Kashif" name vs CLI) interacts with caller identity claims.

## Owner decisions required

- [ ] Choose Option A or B (or defer, keeping SEC-001 open and no prod traffic)
- [ ] Appoint UAE counsel for PDPL/data-residency + DPA review
- [ ] Authorize implementation branch + budget (IdP operating costs)

No production authentication, deployment, or live calling is approved by this package.

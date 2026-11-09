# CALLFORGE OMEGA — SEC-001 Identity Provider Decision Dossier

Date: 2026-11-09. Status: **DECISION REQUIRED (owner approval)**.
Blocker: SEC-001 — `/oauth/authorize` is unauthenticated; M02 is a
simulation baseline, not production identity.

## Comparison (research by IDENTITY-ENGINEER, 2026-11-09)

| Criterion                  | WorkOS AuthKit                | Clerk                     | Keycloak (self-host)    | Auth0                 | Supabase Auth     | Firebase                       |
| -------------------------- | ----------------------------- | ------------------------- | ----------------------- | --------------------- | ----------------- | ------------------------------ |
| OAuth 2.1/OIDC + PKCE      | Yes, S256 mandatory           | Yes                       | Yes                     | Yes                   | Yes               | Client-only — **disqualified** |
| MCP auth (9728/8707)       | **Best-in-class**, documented | Good, MCP guide           | Good, experimental 8707 | Generic               | Weak              | None                           |
| Multi-tenancy              | Organizations                 | Organizations             | Organizations/realm     | Organizations         | Gated (Team)      | Weak                           |
| Ops                        | SaaS, zero                    | SaaS, zero                | Heavy (self-run)        | SaaS, zero            | SaaS              | SaaS                           |
| Small-scale cost           | ~$0 start; SSO $125/conn      | $25/mo Pro; B2B add-on    | $0 + VPS + time         | Steepest at B2B scale | $25/mo Pro        | Per-MAU                        |
| Migration from `oauth.mjs` | Low–Med (JWKS verify swap)    | Low–Med (Next.js gravity) | High                    | Med                   | Med (PG coupling) | N/A                            |

## Recommendation

- **Primary: WorkOS AuthKit** — only candidate with end-to-end MCP-native
  OAuth 2.1 (9728 discovery + 8707 audience binding + DCR/CIMD + token
  exchange), organizations mapping 1:1 to CALLFORGE tenants, zero IdP ops,
  near-zero starting cost.
- **Fallback: Clerk** — strong Organizations + MCP path, predictable
  pricing, but younger OAuth-AS surface and Next.js-centric SDKs.
- **Conditional override:** if UAE PDPL data residency is ruled a hard
  requirement, **Keycloak (managed)** becomes primary despite ops cost.

## Exact owner approval needed (all five, before implementation)

1. Written sign-off naming WorkOS AuthKit (or Keycloak residency override).
2. Approved monthly budget cap + SSO per-connection price point.
3. Authorization to create the WorkOS environment and store secrets in a
   named secret manager (to be stood up — currently a gap).
4. Deployment authorization: publish `/.well-known/oauth-protected-resource`,
   cut token verification to JWKS, retire `cf_dev_` tokens.
5. DPA/cross-border data-processing review (or residency waiver).

No implementation, credentials, or spend until all five are recorded.

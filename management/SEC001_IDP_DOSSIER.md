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

## Validation update (2026-11-09, against current official docs)

- **WorkOS:** OAuth 2.0-based Connect + OIDC discovery (`/.well-known/openid-configuration`,
  `jwks_uri`); PKCE S256 mandatory for public clients; described as
  OAuth 2.1-aligned — **no formal OAuth 2.1 conformance certification is
  published** (OAuth 2.1 remains a draft consolidation). MCP: RFC 8707
  resource indicators are GA (dashboard-registered, `aud` stamping).
  Pricing: AuthKit first 1M MAU free, then $2,500 per additional 1M;
  SSO connections extra (~$65–80 each).
- **Clerk:** OAuth 2.0 + OIDC; `Require PKCE` default ON (S256 enforced);
  no published conformance cert. MCP: RFC 9728 + `aud` enforcement GA.
  Pricing corrected: free to **50,000 MRU** (raised 5 Feb 2026 — older
  "10k free" comparisons are stale); Pro $25/mo.
- **Keycloak:** MCP RFC 8707 exists but remains **experimental**
  (`--features=resource-indicators`); CIMD experimental. Earlier claim
  "not implemented" (26.4.0 notes) is superseded but GA status is not
  reached — its MCP story is currently the weakest of the three.
- **Data residency (decisive):** WorkOS stores/processes identity data in
  the **United States only** (DPA Exhibit B); Clerk explicitly offers **no
  regional residency** (US-hosted, DPF). **Neither can be sold as
  UAE-resident.** Only self-hosted Keycloak in a UAE region satisfies
  residency. UAE PDPL permits cross-border transfers via adequacy /
  contractual safeguards / derogations — a legal determination, not an
  engineering one.

**Recommendation stands** (WorkOS primary, Clerk fallback, Keycloak only
on residency grounds), but the gating approval is now sharper:

> **Single named sign-off required:** a legal/DPO written determination
> that US-hosted identity processing under WorkOS's DPA is lawful for UAE
> end-users under UAE PDPL cross-border provisions AND acceptable to target
> UAE enterprise customers. If denied, Keycloak-in-UAE-region is triggered
> with re-scoped timeline + ops budget. No further IdP research is needed
> either way.

Secondary: security sign-off to use "OAuth 2.1-aligned, not certified"
language in customer-facing documents for whichever vendor is chosen.

## Exact owner approval needed (all five, before implementation)

1. Written sign-off naming WorkOS AuthKit (or Keycloak residency override).
2. Approved monthly budget cap + SSO per-connection price point.
3. Authorization to create the WorkOS environment and store secrets in a
   named secret manager (to be stood up — currently a gap).
4. Deployment authorization: publish `/.well-known/oauth-protected-resource`,
   cut token verification to JWKS, retire `cf_dev_` tokens.
5. DPA/cross-border data-processing review (or residency waiver).

No implementation, credentials, or spend until all five are recorded.

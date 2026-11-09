# CALLFORGE OMEGA — Security Gap Analysis

Date: 2026-11-09
Status: M01 review candidate

## Controls present in the reconstructed baseline

- Development tokens are stored as SHA-256 hashes rather than plaintext.
- Database operations use parameterized SQLite statements.
- Tenant identifiers are included in primary application queries covered by tests.
- Simulated call creation has a tenant-scoped unique idempotency constraint.
- Audit events are hash-linked and direct payload tampering is detected by tests.
- Call destinations are represented as masked values in test fixtures.
- No telephony adapter, carrier credential, or live-call dispatch implementation exists.
- Package audit currently reports no known vulnerabilities.

## Critical gaps before production

1. Development bearer tokens are not OAuth and do not implement production audience, issuer, PKCE, session, or revocation requirements.
2. `requireScopes` is a placeholder and does not enforce least privilege.
3. Tool handlers accept tenant IDs in model-accessible arguments; M02 must derive tenant membership from authenticated server context.
4. Several handlers require systematic negative cross-tenant tests beyond the current happy-path suite.
5. SQLite files are not application-encrypted at rest and backups are not implemented.
6. Audit chaining is tamper-evident, not immutable; a privileged database writer can rewrite an entire chain.
7. Compliance validation is simulation data, not trusted evidence from authoritative services.
8. No separate human-approval interface, signed approval receipt, suppression service, DNCR integration, or calling-hours policy engine exists.
9. No signed provider webhooks, replay defense, telephony reconciliation, or spending limits exist.
10. No production secret manager, retention policy, privacy workflow, SAST pipeline, or secret scan is yet configured.

## M01 security verdict

The simulation baseline preserves the no-live-calling boundary and has green local security-relevant regression tests. It is not production-authenticated, regulatory-verified, or suitable for real customer data. M02 and later security gates remain mandatory.

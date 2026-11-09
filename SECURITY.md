# Security Policy

## Current classification

CALLFORGE v0.2 is a simulation-first development baseline. It is not approved for production, live calls, real customer data, public exposure, or regulatory claims.

## Supported security controls

- Parameterized SQLite statements.
- Hashed development tokens.
- Tenant-scoped idempotency.
- Hash-linked audit events with tamper-detection tests.
- Dependency audit in CI.
- Explicit absence of a live telephony provider.

## Known limitations

See `SECURITY_GAP_ANALYSIS.md`. In particular, OAuth, RBAC, server-derived tenant context, trusted compliance evidence, human approval, encryption, signed webhooks, replay protection, secret management, and production retention controls are not implemented.

## Reporting

Do not include credentials, customer data, or exploit payloads in a public issue. Report security concerns privately to the repository owner. No bug-bounty or response SLA is currently declared.

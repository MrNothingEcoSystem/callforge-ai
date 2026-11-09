# Changelog

## Unreleased — M01 review candidate

### Added

- Specification-derived CALLFORGE v0.2 simulation baseline.
- Eleven MCP tools, SQLite persistence, development auth, audit chaining, and Arabic/English fixtures.
- Vitest, ESLint, Prettier, TypeScript check-JS, dependency audit, and GitHub Actions gates.
- Phase Zero and M01 evidence documents plus machine-readable milestone ledger.

### Fixed

- Audit tamper detection verification.
- Test database initialization and isolation.
- MCP store import and handler initialization.
- Tool input defaults, call-event hashing, deterministic fixture loading, SQL timestamp quoting, and compliance aggregation.
- `create_dev_token` executes successfully through the declared Node.js ESM runtime.
- The HTTP status path rejects cross-tenant call-intent lookup.
- Audit append operations are serialized across logger instances and ordered by SQLite row sequence.
- Vulnerable test/runtime dependencies.

### Safety

- No live telephony provider or production deployment is included.
- No v0.2 release tag has been created.

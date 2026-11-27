# CALLFORGE OMEGA — Ascension Decisions

- **D-001 (2026-11-09):** Canonical repo is `MrNothingEcoSystem/callforge-ai`.
  Legacy `Davidcarmelalex/CALLFORGE` is read-only history; never write to it.
- **D-002:** Every milestone ships on a dedicated branch + draft PR with
  exact-head CI evidence and independent review. No direct protected merges.
- **D-003 (2026-11-09):** Exactly one CALLFORGE dispatcher exists. Audit found
  zero CALLFORGE cron jobs; one `CALLFORGE OMEGA dispatcher` cron created.
  Existing AZRAEL/AETHERFORGE/FCRI jobs untouched. No duplicate schedulers.
- **D-004:** Branding assets (`docs/brand/`) were authored to the directive's
  ASIC-inspired description; no prior spec file was found on disk. Owner may
  replace them with an approved spec at any time.
- **D-005:** M02 uses custom minimal OAuth 2.1 + PKCE (simulation baseline).
  Whether a mature IdP is preferable is an explicit M02 review question;
  a switch requires a new branch + PR, never silent replacement.
- **D-006:** SQLite remains the system of record for the simulation
  baseline; PostgreSQL evaluation is an M03 design deliverable before any
  migration commitment.
- **D-007:** Telegram engineering reports use the established authorized
  channel `telegram:8400775109` only. Delivery is claimed only from actual
  `hermes send` success receipts.

- **D-008 (2026-11-27):** TECH-004 answered as a _conditional_ decision record, not a
  port: SQLite stays the system of record through M06/M09 single-node work; PostgreSQL is
  the committed target at the first genuine availability or archival trigger; the
  facade-first option is rejected. No migration is authorised, and any port must be cut
  after the current merge queue (#193/#194/#189/#191/#192) drains. Record:
  `management/TECH004_DB_DECISION.md`; supersedes the open half of D-006.

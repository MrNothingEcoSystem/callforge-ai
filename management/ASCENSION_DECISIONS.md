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

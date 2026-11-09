# CALLFORGE OMEGA — Dependency and Blocker Register

Date: 2026-11-09

| ID         | Dependency or blocker                                     | Milestone  | Status                      | Next action                                                                  |
| ---------- | --------------------------------------------------------- | ---------- | --------------------------- | ---------------------------------------------------------------------------- |
| SRC-001    | Original v0.2 source bundle unavailable                   | M01        | Open external blocker       | Stakeholder may supply artifacts for source comparison                       |
| REV-001    | Independent review of M01                                 | M01        | Pending                     | Review draft PR and exact-head evidence                                      |
| CI-001     | Hosted CI evidence                                        | M01        | Pending until workflow runs | Verify GitHub Actions on exact PR head                                       |
| AUTH-001   | Production OAuth/PKCE and tenant derivation               | M02        | Pending                     | Begin only after M01 review candidate is published                           |
| ARM-001    | AgentRunMe API/integration contract                       | M07-M10    | External blocker            | Obtain interface and authorization specification                             |
| UAE-001    | UAE carrier authorization                                 | M05/M12    | External blocker            | Sandbox only until verified authorization exists                             |
| LEGAL-001  | UAE legal/privacy review                                  | M04/M12    | External blocker            | Obtain qualified human review; do not claim certification                    |
| DATA-001   | Authorized Arabic/English evaluation data                 | M06        | Pending                     | Use synthetic data until an authorized corpus is approved                    |
| STAGE-001  | Approved HTTPS staging endpoint                           | M09        | Pending approval            | Do not deploy without explicit approval                                      |
| BILL-001   | Billing provider and charging approval                    | M10        | External blocker            | Implement sandbox abstraction only                                           |
| HERMES-001 | Default Hermes provider config names unsupported `ollama` | Automation | Open internal warning       | Correct through supported config workflow before a persistent worker uses it |
| HERMES-002 | Local `custom:mrnothing` provider timeouts                | Automation | Active reliability blocker  | Route bounded work only to a verified available provider                     |

## Resolved during M01

- Node.js 24 validation toolchain established.
- pnpm 12.18.0 available through Corepack.
- Canonical private repository created.
- Test initialization, audit integrity, formatting, linting, and dependency vulnerabilities corrected.
- Full suite: 54 passed, 0 failed, 0 skipped.

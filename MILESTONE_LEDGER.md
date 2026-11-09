# CALLFORGE OMEGA — Milestone Ledger

The machine-readable source of truth is `milestone-ledger.json`.

| Milestone                           | Status         | Evidence / next gate                                                             |
| ----------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| M00 — Discovery                     | Complete       | Phase Zero audit documents                                                       |
| M01 — Baseline stabilization | **Accepted** (ACCEPT WITH FOLLOW-UPS, `76bb062`) | 58/58 tests; lint, format, typecheck, audit green; REV-001 + CI-001 closed; 6 follow-up issues; SRC-001 remains open |
| M02 — Identity and tenant isolation | **In progress** | Dedicated branch: OAuth/PKCE, verified tenant context, RBAC, scopes; tenant-identity issue is the critical security gate |
| M03 — Durable workflow              | Pending        | Depends on M01 and M02                                                           |
| M04 — UAE compliance and approval   | Pending        | Depends on M02 and M03                                                           |
| M05 — Telephony adapters            | Pending        | Sandbox only; carrier authorization external                                     |
| M06 — Voice intelligence            | Pending        | Synthetic/authorized data only                                                   |
| M07 — Business integrations         | Pending        | AgentRunMe contract required                                                     |
| M08 — Business console              | Pending        | Depends on identity and integrations                                             |
| M09 — ChatGPT integration           | Pending        | HTTPS staging requires approval                                                  |
| M10 — Commercial SaaS               | Pending        | Sandbox billing only                                                             |
| M11 — Security and reliability      | Pending        | Independent verdict required                                                     |
| M12 — Release candidate             | Pending        | Engineering readiness is not launch authorization                                |

M01 is not marked complete until hosted exact-head CI and independent review are recorded.

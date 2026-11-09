# CALLFORGE OMEGA — Milestone Ledger

The machine-readable source of truth is `milestone-ledger.json`.

| Milestone                           | Status         | Evidence / next gate                                                             |
| ----------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| M00 — Discovery                     | Complete       | Phase Zero audit documents                                                       |
| M01 — Baseline stabilization        | Review pending | 58/58 tests; lint, format, typecheck, audit green; independent re-review pending |
| M02 — Identity and tenant isolation | Pending        | Starts after M01 acceptance                                                      |
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

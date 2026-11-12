# CALLFORGE OMEGA — Ascension Roadmap

Program order (from directive v1.0): M02 security acceptance → M03
durability → M04 compliance → M05 telephony → M06 voice → M07
integrations → M08 console → M09 remote MCP → M10 SaaS → M11
security/reliability → M12 release candidate → M13 plugin package →
M14 integration verification → M15 submission (stops at approval gate)
→ M16 operations.

## Phase plan

| Phase          | Milestones | Entry gate                  | Exit gate                                    |
| -------------- | ---------- | --------------------------- | -------------------------------------------- |
| P1 Identity    | M02        | M01 accepted                | Independent security ACCEPT; issue #1 closed |
| P2 Durability  | M03        | M02 accepted                | Crash/duplicate/restore evidence             |
| P3 Trust       | M04        | M02+M03                     | Fail-closed policy + legal review register   |
| P4 Voice       | M05+M06    | M03                         | Sandbox lifecycle + benchmark thresholds     |
| P5 Business    | M07+M08    | M03                         | Connected console + integrations             |
| P6 Platform    | M09+M10    | M02                         | Remote MCP conformance + SaaS sandbox        |
| P7 Assurance   | M11        | all above                   | Independent security/reliability verdict     |
| P8 Release     | M12        | M11                         | Signed RC dossier + human approval           |
| P9 Publication | M13–M15    | M12                         | Submission-ready checklist (stop at gate)    |
| P10 Operations | M16        | actual publication approval | SLOs + runbooks live                         |

External gates tracked in ASCENSION_BLOCKERS.md; engineering proceeds in
parallel where independent.

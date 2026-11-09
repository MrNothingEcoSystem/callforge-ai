# CALLFORGE OMEGA — Ascension Blockers

## External gates (owner authorization required)

| ID      | Gate                                                 | Blocks                     |
| ------- | ---------------------------------------------------- | -------------------------- |
| EXT-001 | SRC-001: original v0.2 source bundle missing         | source-equivalence claims  |
| EXT-002 | Qualified UAE legal/privacy review                   | M04 closure, public claims |
| EXT-003 | Authorized UAE telephony provider + carrier contract | M05 live activation        |
| EXT-004 | Production hosting + deployment approval             | M12 release                |
| EXT-005 | Paid voice API credentials (ASR/TTS)                 | M06 live benchmarks        |
| EXT-006 | CRM OAuth app registrations                          | M07 connectors             |
| EXT-007 | Billing provider approval                            | M10 real charging          |
| EXT-008 | OpenAI publisher verification + domain ownership     | M15 submission             |
| EXT-009 | Final publication approval                           | M16                        |

## Technical blockers

| ID       | Blocker                                           | Status                           | Next action                                     |
| -------- | ------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| TECH-001 | M02 PR #7 independent security verdict pending    | In progress (auditor dispatched) | Record verdict; fix blocking findings on branch |
| TECH-002 | Issues #2, #4, #5, #6 open follow-ups             | Open                             | Schedule into M02/M03 branches                  |
| TECH-003 | No durable workflow layer yet                     | M03 design dispatched            | Implement increment 1                           |
| TECH-004 | Postgres vs SQLite decision                       | M03 evaluation                   | Design deliverable                              |
| TECH-005 | CALLFORGE dispatcher not yet proven over 2 cycles | Pending                          | Run + verify recovery                           |

Engineering continues on independent work whenever a gate is blocked.

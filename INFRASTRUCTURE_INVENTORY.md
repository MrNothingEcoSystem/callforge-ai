# CALLFORGE OMEGA — Infrastructure Inventory

Date: 2026-11-09
Host: srv2088822

## Platform

| Item                   | Verified state                                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| OS                     | Ubuntu 26.04.1 LTS, kernel 7.0.0-42-generic, x86_64                      |
| Compute                | 8 CPU cores, approximately 31 GiB RAM, no swap                           |
| Storage                | Approximately 387 GB root filesystem                                     |
| System Node.js         | v22.22.1                                                                 |
| M01 validation Node.js | v24.22.2, isolated toolchain under Hermes scratch                        |
| Package manager        | pnpm 12.18.0 through Node 24 Corepack                                    |
| GitHub CLI             | Authenticated as `Davidcarmelalex`; scopes include `repo` and `workflow` |
| Docker                 | Installed and running                                                    |
| SQLite                 | Available; CALLFORGE uses embedded `better-sqlite3`                      |
| Public listeners       | nginx occupies ports 80 and 443                                          |
| CALLFORGE service      | Not deployed or running                                                  |

## Hermes

- User gateway `hermes-gateway.service` is active and survives logout.
- OpenAI Codex authentication is available.
- The configured default provider contains an invalid legacy `ollama` provider value; this is a Hermes configuration warning and was not changed during M01.
- The local `custom:mrnothing` provider has recent timeout failures.
- Telegram delivery is already used by existing authorized cron jobs.
- Existing AZRAEL/FCRI/AETHERFORGE schedules were not modified.
- No CALLFORGE recurring dispatcher existed at inspection time.

## Resource and coexistence constraints

- nginx ports 80/443 are shared infrastructure; CALLFORGE must not bind or reconfigure them without deployment approval.
- Existing repositories and dirty AZRAEL checkouts were not modified.
- The gateway is memory-heavy; future worker concurrency must be bounded.
- No production database, queue, telephony provider, DNS, or staging endpoint has been provisioned for CALLFORGE.

## Secrets inventory policy

Only secret names and availability were inspected. No secret values are recorded in this repository. GitHub authentication and Telegram delivery are available through existing authorized mechanisms. No CALLFORGE-specific provider credentials were found.

# CALLFORGE OMEGA — Ascension Baseline (immutable snapshot)

Snapshot date: 2026-11-09. Program: Project Ascension (directive v1.0).

## Canonical repository

- `MrNothingEcoSystem/callforge-ai` (public, default branch `main`)
- Legacy source repository: `Davidcarmelalex/CALLFORGE` (private; do not write)
- VPS checkout: `/root/callforge-ai` (canonical remote is authoritative)

## Verified state at snapshot

| Item                | Verified fact                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main` SHA          | `92b07f2b00d99d2473297ef4d08a45f1b27219b6`                                                                                                                                   |
| `main` CI           | PASS (run 42559851556, M01 quality gates)                                                                                                                                    |
| M01 accepted commit | `76bb06235e098904fae390acf48b11b1f57aa7d8` — ACCEPT WITH FOLLOW-UPS, REV-001/CI-001 closed, SRC-001 open                                                                     |
| M02 branch/PR       | `m02-oauth-tenant-isolation`, draft PR #7, head `ac0adcba2f87efe95e647bb1eda08ba790f0492a`, CI PASS                                                                          |
| Tests (M02 branch)  | 70/70 passing; typecheck/lint/format/audit green                                                                                                                             |
| Open issues         | #1 M02 critical gate, #2 verifyChain(fromEventId), #3 await close (fixed in M02 branch, pending review), #4 rowid pagination, #5 node:crypto in tests, #6 start() smoke test |
| Branding            | `docs/brand/` — ASIC-inspired mark + banner + BRAND.md                                                                                                                       |

## Automation state at snapshot

- Hermes cron jobs: 6 total; none CALLFORGE-specific. AZRAEL supervisor disabled.
- CALLFORGE dispatcher: **none existed at snapshot** → one created under Project Ascension (see ASCENSION_DECISIONS.md D-003).
- Telegram reporting channel: `telegram:8400775109` (established authorized channel).
- Gateway: `hermes-gateway.service` active.

## Hard boundaries (unchanged)

No production deployment, no live calls, no paid services, no plugin
publication, no protected-branch merge without explicit owner authorization.

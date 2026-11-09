# CALLFORGE OMEGA — Repository Discovery

Date: 2026-11-09

## Canonical repository

- Repository: `Davidcarmelalex/CALLFORGE`
- URL: https://github.com/Davidcarmelalex/CALLFORGE
- Visibility: private
- Default branch: `main`
- Initial main commit: `ef277d2c48c8238aa7abced36883aaf8de570327`
- M01 branch: `m01-baseline-stabilization`

## Discovery history

At the start of Phase Zero, neither a local CALLFORGE source tree nor a GitHub repository was present. The claimed `AgentRunMe` GitHub owner was not recognized. The private repository above was subsequently created under the authenticated user account.

The supplied v0.2 filenames were not found before reconstruction. Therefore:

1. The current implementation is specification-derived.
2. The missing original source remains an external provenance blocker.
3. A feature-by-feature comparison can only compare the current code against the written v0.2 requirements, not against original artifacts.

## Working tree policy

- `/root/CALLFORGE` is the canonical local checkout for this program.
- Generated `node_modules/`, SQLite `data/`, coverage output, logs, and local environment files are ignored.
- Milestone work occurs on dedicated branches and is submitted through reviewable pull requests.
- Protected-branch merge and production deployment require explicit approval.

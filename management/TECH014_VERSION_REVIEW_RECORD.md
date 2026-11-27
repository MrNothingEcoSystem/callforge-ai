# TECH-014 — concurrent PUT version fence: review record

Date: 2026-11-27 (cycle 233)
Subject: `tech-014-policy-lww` @ `ae8a20f`, draft PR #209, stacked on #208
Mode: read-only worktree probe. The worktree at the parent commit `66d5012` was
never written to; the only mutation was copying the probe harness and test file
into it. (No separate auditor agent was available this cycle — the probe is the
review, and the diff is small enough to read in full.)

## Claim under test

Two admins PUT the same tenant policy. Before the change both get 200 and the
first edit disappears; the loser has no way to know. After the change the loser
gets 409, is told the current version and policy, and the stored row is the
winner's.

## Probe

`behaviour.mjs` over a fresh DB: seed policy A at version 1, then two HTTP PUTs
that both carry `version: 1` (both operators read version 1). A lands, B is
superseded.

| tree | winner PUT | stale PUT | stored window | stored version |
|---|---|---|---|---|
| `66d5012` (pre-fix) | 200 | **200** | 10–20 (A's 07:00 silently lost) | (no column) |
| `ae8a20f` (post-fix) | 200 | **409** | 07–18 (A preserved) | 2 |

Also probed: migration `0012` applied to a database populated under 0001–0011 —
applies, existing row backfills to version 1, `UPDATE … WHERE version = 99` is a
0-change no-op while `= 1` changes 1. Draft test file copied to the pre-fix
worktree fails 10/10; on the fixed tree 10/10 pass, full suite 265/265, `tsc`,
`eslint`, `prettier --check .` clean.

## Verdict

**ACCEPT**, with follow-ups.

- F1 (open): `DELETE /tenant/policy` has no fence. A put-then-revert race is
  still last-write-wins; deleteTenantPolicy reads then deletes.
- F2 (open, minor): the version restarts at 1 after a revert (the row is
  deleted), so a client holding version 4 that retries against re-created state
  gets 409 with `version: 0`. A `0` fence parses as "no fence" and writes
  blindly — the safe direction, but a 409 body of `0` is a confusing retry hint.
- F3 (accepted as designed): an omitted or junk version is a blind write. This
  is deliberate backwards compatibility; a client that wants the guarantee must
  send a fence. Worth stating in the API docs when there are any.
- F4 (note): the fence protects against lost updates, not against two writers
  disagreeing about which policy is correct. Both still need a re-read.

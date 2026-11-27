# TECH-014 — fenced policy revert: review record

Date: 2026-11-27 (cycle 234)
Subject: `tech-014-policy-lww` @ `d8bcfa7`, draft PR #209, stacked on #208
Closes: review #209 finding F1 (`DELETE /tenant/policy` had no fence)
Mode: read-only probe in a detached worktree at the parent `66d5012`. The worktree
was never written to except by copying the probe harness and the draft test file
into it; the fixed tree was exercised in place. Cycle-run probe, not a delegated
auditor — labelled as such, as before.

## Claim under test

An operator reverts the tenant policy using the version they read. Another admin
saved in between, so that version is stale. Before the change the stale revert
answers 200 and the newer edit vanishes. After the change it answers 409 with the
current version and policy, the newer edit survives, and nothing is recorded for
a revert that did not happen.

## Probe

`behaviour.mjs` over a fresh DB and a real listening HTTP server: PUT policy A
(07–18) → v1, PUT policy B (10–20) → v2, then `DELETE` carrying `If-Match: "1"`.

| tree                 | stale DELETE | stored window after      | stored version | revision rows              |
| -------------------- | ------------ | ------------------------ | -------------- | -------------------------- |
| `66d5012` (pre-fix)  | **200**      | 09–18 (defaults; B lost) | — (no column)  | reverted, updated, updated |
| `d8bcfa7` (post-fix) | **409**      | 10–20 (B preserved)      | 2              | updated, updated           |

A second scenario starts both requests at version 1 and issues the DELETE and a
competing PUT concurrently: post-fix both serialise to a consistent state (revert
then re-create, or 409), never a surviving row whose policy the loser did not
see.

Draft test file copied into the pre-fix worktree fails 3/23 (the two fence
assertions and the helper's new return shape); on the fixed tree 23/23, full
suite 270/270, `tsc`, `eslint`, `prettier --check .` all clean. Mutation-checked:
dropping the `AND version = ?` clause fails the two fence tests.

## Verdict

**ACCEPT.** F1 closed.

- F2 (open, carried): the version restarts at 1 after a revert because the row is
  deleted, so a fenced revert against re-created state can 409 with `version: 0`
  where `0` parses as "no fence". Safe direction, confusing hint.
- F3 (new, accepted as designed): the fence is `If-Match` only — DELETE carries no
  body, so unlike PUT there is no body `version` alias. Junk/absent fence degrades
  to the old last-write-wins revert.
- F4 (note, carried): the fence prevents lost updates, not two writers disagreeing
  about which policy is correct. Both still need a deliberate re-read.

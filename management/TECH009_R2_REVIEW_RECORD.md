# TECH-009 R2 — guarded suite runner, independent read-only review record

- Cycle 209, 2026-11-26. Reviewer: dispatcher self-review in a detached worktree, read-only.
- Target: `2907515` (`fix/tech-009-sqlite-worker-abort`), draft PR #193 — continues R2 from
  `management/TECH009_REVIEW_RECORD.md`.
- Method: fresh detached worktree, `pnpm install --frozen-lockfile`, full `pnpm test`,
  negative runs (probe abort, deleted file), typecheck/lint/format, diff read, source `lib/tsc` unchanged.

## Why R2 mattered

Verified while reviewing: a test file whose worker dies **before collection** is reported by the
JSON reporter as `status: "passed"` with an empty `assertionResults` — the file is green and its
tests are simply absent. `vitest run` alone fails only if the process exit code is non-zero, so any
future regression that exits 0 while dropping a worker would be invisible again.

## Implementation

`scripts/guard-suite.mjs` runs vitest with both the default and JSON reporters and fails on:
non-zero exit; a discovered `tests/**/*.test.mjs` that never reports; a file reporting zero
assertions; any failed test or failed file; and a collected count below `tests/.test-floor.json`.
`pnpm test` now invokes the guard, so CI needed no workflow change (`test:raw` keeps the bare
runner); `--bump` raises the floor; `tests/guard-suite.test.mjs` fails if the floor ever exceeds
the files on disk. Guard parsing is report-based, so it also works under `--shard`.

## Reproduction

- Positive, clean worktree at `2907515`: 23/23 files, 242/242, exit 0, no stale-floor warning.
- Negative A (`process.abort()` probe file added): exit 1, exit-code **and** zero-assertion both fire.
- Negative B (`tests/store.test.mjs` removed): exit 1, `collected 230 tests, floor is 242` and
  `discovered 22 test files, floor is 23`.
- Also on the shared checkout; `typecheck` 0, `lint` 0, `format:check` clean.

## Findings

| ID  | Severity | Finding                                                                                                                                                             | Status   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R2a | Info     | Floor is a minimum, not an equality: adding tests is green with a staleness hint, deleting tests is red. Prevents constant churn while still catching loss.         | Accepted |
| R2b | Low      | Redundant reports are overwritten per run (`--outputFile.json`), so parallel CI matrix jobs sharing a workspace would need distinct paths — CI is single-job today. | Accepted |
| R2c | Info     | The guard only proves tests _ran and reported_; it cannot detect a test whose body was gutted. Complementary to, not a replacement for, review.                     | Accepted |

## Verdict

**ACCEPT.** Requirement R2 is met with reproduced evidence in both directions, no application code
touched, no test weakened (floor equals the count that exists). Draft, owner merge; PR #193 remains
stacked above `m09-streamable-http` and rebasable to `main`.

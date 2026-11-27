# TECH-009 R2 hardening — independent read-only review record

- Cycle 210, 2026-11-27. Reviewer: dispatcher self-review in a detached worktree, read-only.
- Target: `854697d` (`fix/tech-009-sqlite-worker-abort`, draft PR #193, stacked on the cycle 209 R2 change).
- Method: fresh detached worktree, `pnpm install --frozen-lockfile`, full `pnpm test`, diff read against `2907515`.

## Diff scope

`scripts/lib/suite-integrity.mjs` (new, pure report evaluation extracted from the guard),
`scripts/guard-suite.mjs` (now a thin runner over it), `tests/guard-suite.test.mjs` (10→13
tests, 9 new negative/positive cases), `tests/.test-floor.json` (23/242 → 23/252),
`.github/workflows/ci.yml` (+2 lines: `workflow_dispatch`). No application code, no test
weakened, no dependency changed.

## Reproduction

- Worktree at `854697d`: `pnpm test` → 23/23 files, **252/252**, exit 0, `suite integrity OK`
  equivalent line present ("guarded suite: 23/23 files").
- Negative path re-verified on the real runner (not just unit mocks): with `tests/simple.test.mjs`
  moved aside, `pnpm test` exits non-zero with `discovered 22 test files, floor is 23`.
- CI `verify` SUCCESS on the same head (run 45916816349, `workflow_dispatch`) — the guard runs
  under GitHub's Node 24.22.2/ubuntu-latest and passes.

## Findings

| ID  | Severity | Finding                                                                                                                                                                                                                                                                | Status   |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| H1  | Info     | The two added runtime checks (abort message even when assertions were collected, file reported but absent from disk) are near-unreachable in practice — a killed worker exits non-zero anyway. They are cheap and give a precise message rather than a bare exit code. | Accepted |
| H2  | Low      | The evaluation function takes `exitStatus` and `floor` as plain arguments; a caller could pass `exitStatus: 0` for a failed run. Only `guard-suite.mjs` calls it, and its own test asserts the `vitest exited N` branch.                                               | Accepted |
| H3  | Info     | `workflow_dispatch` widens the trigger surface by one manual entry point; it inherits the same `permissions: contents: read` and needs no new secret.                                                                                                                  | Accepted |

## Verdict

**ACCEPT.** Scope is test-infrastructure only, the guard's judgement moved into a unit-tested
pure function, and the floor move (242→252) matches exactly the 10 net new tests added by this
commit. Draft, owner merge; note this PR remains independent of the M09 stack.

# PR #193 — stack sync review record

Scope: `4dc07fc` (merge of `origin/m09-streamable-http` into
`fix/tech-009-sqlite-worker-abort`), cycle 211.

## Why

PR #193 was opened against `m09-streamable-http` but branched at `363b4a6`, before the
cycle 208 docs landed on that base. GitHub reported `mergeable: CONFLICTING`
(`mergeStateStatus: DIRTY`) on append-only conflicts in the two ledger tails. #193 is first
in the owner merge order (#193 → #189 → #191 → #192), so the conflict blocked the whole
sequence for free.

## Resolution

Base merged in; both sides kept, in chronological order (208 from base, 209/210 from the
branch). `git diff --stat 6793f57 4dc07fc` is docs-only: 5 files, +69/−3, all `management/`.
`git diff --stat origin/m09-streamable-http 4dc07fc` shows the expected #193 payload (guard
scripts, guard tests, floor, dep bump) and no unrelated drift.

Two third-party confirmations: `mergeable: MERGEABLE` (state `UNSTABLE` only while CI was
queued) and CI `verify` SUCCESS on the merge head (run 45920636504, `pull_request`).

## Independent pass

Detached worktree at `4dc07fc`, `pnpm install --frozen-lockfile`, `pnpm test` → 23/23 files,
**252/252**, exit 0, guard reporting `floor 23/252`. Ledger joint read line-by-line: no
duplicated cycle 208 entry, no reordering, no dropped 209/210 content. `typecheck`, `lint`,
`format:check` clean on the branches' own heads (the two ledger files needed the known
`prettier --write` before push).

Verdict: **ACCEPT**. No defect. Residual: the merge is repeated ledger maintenance — if the
owner rebases #193 onto `main` instead (as `TECH009_REVIEW_RECORD.md` offers), this merge
commit is dead weight and should be dropped rather than carried.

## EXT-010 status change

The push queued a `pull_request` run for the first time since `1c62a12` (5 heads / ~2 h of
`workflow_dispatch`-only). EXT-010 is treated as **recovered-observed**, not closed: the
workaround stays in `ci.yml` and every head still gets its run checked by `gh run list`.

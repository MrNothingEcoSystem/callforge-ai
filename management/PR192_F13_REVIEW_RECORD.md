# PR #192 — F13 review record (`requestState` signing)

- **Item:** F13 (Info, raised cycle 200, re-noted 203/204) — `requestState` is unsigned
  base64url JSON, so a client can hand-edit the fingerprint it echoes back.
- **Head reviewed:** `276c6db` (code `30ee1e3`), read-only, detached worktree
  `/tmp/…/wt-review`, `pnpm install --frozen-lockfile`.
- **Diff:** `1c62a12..276c6db` — 2 files, +137/−10 (`mcp-elicitation.mjs`,
  `tests/m09-elicitation.test.mjs`). No dependency, workflow or enforcement value changed
  on the reviewed head.
- **Reproduced:** `tests/m09-elicitation.test.mjs` 22/22 in the review worktree, including
  the transport-level case where a signature-stripped state re-issues and writes nothing.
  Full guarded suite at `276c6db` **merged with `origin/fix/tech-009-sqlite-worker-abort`**
  (the base still pins `better-sqlite3` 11.10, so a raw run on the base alone SIGABRTs 4
  workers — TECH-009): 23/23 files, 256/256, exit 0. typecheck, lint, `format:check` clean
  on the head.

## Verdict

**ACCEPT.** Minimal, additive and fail-stale by construction; the gate's decisions are
unchanged. No new defect.

## Residuals

- H1 (Info) — the HMAC key can be the token secret; purposes are separated only by the
  `v1.` domain prefix in the signed message. A dedicated secret is the cleaner posture and
  the env var exists for it.
- H2 (Info) — a per-process random key (no secret configured) makes a resume that lands on
  another instance re-issue. Correct, but it is a load-balancing note for deployment.
- H3 (Info) — a state minted before this change (same process only) is now stale; there is
  no migration path by design.

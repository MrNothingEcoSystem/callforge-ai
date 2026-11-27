# TECH-015 F5 — independent read-only verification

- **Subject:** `616379d` (branch `tech-015-f5-intent-crosscheck`, draft PR #205), which closes F5 from
  `management/TECH015_REVIEW_RECORD.md`.
- **Method:** fresh detached worktree at the subject commit, suite reproduced, plus an out-of-band
  probe against _both_ the pre-fix commit (`7488ec2`) and the subject: seed a tenant/intent, drive a
  request to `allowed`, then call the sink once with the real row and once with `aggregate_id`
  replaced.
- **Result, pre-fix:** the tampered row returns `accepted: true` and the provider records a second
  call for the same request — the divergence the finding described is reachable if the row and
  request ever disagree.
- **Result, subject:** clean row `accepted`, tampered row `{ noop: true, reason: 'intent_mismatch' }`,
  provider still at one call, `call_attempts` still at one row. Guard is ahead of the claim, so no
  attempt is burned.
- **Suite:** 230/230 in the worktree. tsc/eslint 0, prettier clean at the subject.
- **Reading of the guard:** absent `aggregate_id`/`callIntentId` are tolerated rather than treated as
  a mismatch; `aggregate_id` is `NOT NULL` in `0002`, so this only widens tolerance for a partial
  hand-built row, not for production rows.
- **Verdict: ACCEPT.** No defect found; F5 closed.

Residual (not introduced here): `tenant_id` agreement between row and request is still unchecked.
Both derive from the same request inside the gate transaction, and `requestDial` already rejects an
intent belonging to another tenant (review F1), so it is not reachable — recorded, not fixed.

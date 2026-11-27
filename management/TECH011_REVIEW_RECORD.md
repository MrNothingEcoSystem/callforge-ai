# TECH-011 review — dial gate on the dispatch path

Cycle 219 independent pass, 2026-11-27, read-only detached worktree at `0034113`.
Scope: `0005_dial_requests.sql`, `workflow/dialGate.mjs`, the dispatcher registry entry,
the migration-set test change, `tsconfig.json` and the ledger. Test corpus read for
weakening. Verdict: **ACCEPT WITH FOLLOW-UPS**.

## Checked and sound

- Producer atomicity: insert + `dial.requested` enqueue share one `db.transaction`, so no
  gate-less dial can exist. The `(tenant, key)` unique index makes a losing concurrent
  duplicate throw rather than double-enqueue.
- Double-dispatch: the decision `UPDATE … WHERE status = 'pending'` re-checks inside the
  transaction, so a redelivered outbox row is a no-op, and `call.dial` carries
  `dedupKey: call.dial:<request>` as a second guard.
- A denial returns normally and is acked; only throws hit `fail()` backoff — correct, since
  re-running a deny with unchanged facts cannot flip it.
- Tenant scoping: `readAttempts` and the `call.dial` enqueue both take the _snapshot's_
  tenant, not caller input at dispatch time.
- Fail-closed holds after the JSON round trip: `reviveContact` restores `dncrCheckedAt`, and
  a missing/expired approval still denies (pinned by test).
- `readAttempts` is bounded above by `now` (F2 of the #197 review) and counts `no_answer`
  conservatively; a future-dated row cannot hide today's attempts (verified by probe).
- Test change in `tests/m03-workflow.test.mjs` derives the expected migrations instead of
  hardcoding — no weakening; `again.skipped` still asserts the full set.
- No secrets in the snapshots; phone numbers already appear in existing outbox payloads.

## Findings

- **F1 (Medium, fixed at this head)** — `requestDial` checked neither the intent's
  existence nor its tenant; the FK proves existence only, so an intent id from another
  tenant produced a `dial_requests`/`call.dial` row under the wrong tenant. Now a missing
  intent throws `ReferenceError`, a mismatch `RangeError`, before any write; test added.
- **F2 (Low, open)** — R10 counts _allowed requests_, not actual dial attempts: an allowed
  request that never reaches the M05 sink still consumes ceiling. Acceptable while the sink
  is a no-op; the sink should reconcile outcome and the counter should move to real
  attempts once M05 lands. Recorded here rather than pre-built.
- **F3 (Low, fixed)** — `created_at` was written by the INSERT default and immediately
  overwritten; now inserted directly, one write.
- **F4 (Info)** — a denied request is terminal; re-queueing needs a new idempotency key. The
  compliance dashboard (TECH-012 era) should offer "retry now" that can re-evaluate with
  fresh DNCR/consent instead of a raw duplicate.
- **F5 (Info)** — `0005` leaves a numeric gap until #196's `0004` merges. The runner scans
  the directory, so order stays correct; only the version strings look odd.

## Probes run

Cross-tenant intent (red before fix, green after), future-dated attempt exclusion, double
`dispatchOnce()`, redelivery, and a mutation replacing `attempts` with `[]` (only the
ceiling test reds). Full suite after remediation: **163/163**, tsc 0, eslint 0, prettier
clean, CI `verify` SUCCESS on `0034113`.

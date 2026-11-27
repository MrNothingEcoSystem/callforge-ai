# TECH-015 F3 review — dial-sink claim CAS (PR #204)

Reviewer: dispatcher cycle 228, read-only detached worktree at `70d6219`, plus two out-of-band
SQLite probes. Not a milestone acceptance; PR #204 stays draft.

## Verdict: ACCEPT

## Probes

- **Upgrade path**: built a database through `0009`, inserted tenant → intent → allowed request →
  _accepted_ attempt with a `provider_ref`, then applied `0010`. The accepted row survived intact,
  both new columns NULL, and a fenced `UPDATE … WHERE claim_token = 'x'` after re-claiming matched
  exactly one row. Additive and non-destructive.
- **Real two-process race** (the thing F3 is actually about): seeded one allowed request, launched
  two separate `node` processes against the same WAL database, first parked 3s inside `dial()`.
  Result: `A DIAL` → `accepted`, `B` → `already_dispatching`; exactly one attempt row
  (attempts=1), one `provider_ref`, one intent transition, `claim_token` NULL afterwards.
- **Read of the fence**: every terminal write (error, handle-less, accept) carries
  `AND claim_token = ?`; the accept path returns `superseded: true` and skips the intent
  transition when it lost, so the intent cannot be moved twice.

## Findings (non-blocking)

- **F3-a (Low, by design)** — the lease is not a lock. A worker that is merely slow past 300s can
  still overlap its replacement and produce a second carrier dial. Documented in
  `management/M05_TECH015_F3_CLAIM_CAS.md`; the carrier `idempotencyKey` remains the last defence
  and is EXT-003's to honour.
- **F3-b (Info)** — `claimed_at`/`updated_at` use SQLite `datetime('now')` in whole seconds; a
  sub-second race resolves correctly because the status CAS, not the timestamp, decides the fast
  path.
- **F3-c (Info)** — reclaim increments `attempts`, so a lease reclaim counts against the R10
  ceiling. That is the conservative reading and matches the existing failure-retry semantics.

## Residual risk

In-process and two-process behaviour are both proven on SQLite/WAL; a multi-host dispatcher would
need the same CAS on the real store, which is M03's concern, not this row.

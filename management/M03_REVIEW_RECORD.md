# CALLFORGE OMEGA — M03-1 Review Record

## Verdict history (PR #9, `m03-durable-workflow`)

| Head      | Verdict                                                               | Reviewer                   | Date       |
| --------- | --------------------------------------------------------------------- | -------------------------- | ---------- |
| `dec034e` | **REJECT** — 4 blocking defects                                       | Independent reviewer       | 2026-11-09 |
| `d8f7df0` | **ACCEPT WITH FOLLOW-UPS**                                            | Dispatcher cycle-2 auditor | 2026-11-09 |
| `d8f7df0` | **REJECT** — 1 remaining blocking defect (unknown-intent FK)          | Adversarial re-reviewer    | 2026-11-09 |
| `6c0ffb9` | **ACCEPT** (focused re-verification, all probes pass, 69/69, CI PASS) | Independent re-verifier    | 2026-11-09 |

## The four original blocking defects (fixed in `d8f7df0`)

1. Audit-chain poisoning in `transition()` → fixed (stored `created_at`,
   `actor_id` key, genesis `'0'×64`) + `verifyChain` regression test.
2. Outbox backoff dead code → fixed (`available_at` filter) + reclaim test.
3. NULL-tenant dedup broken → fixed (`tenant_id IS ?`).
4. Reconcile unknown-intent FK throw + event loss → partially fixed in
   `d8f7df0` (intent check) but `recordEvent()` still inserted the bogus
   FK → fully fixed in `6c0ffb9` (`intent ? callIntentId : null`) + test.

## Reviewer conflict note

Two independent reviews of `d8f7df0` disagreed: the cycle-2 auditor
accepted; the adversarial re-reviewer rejected on defect (4). The
adversarial finding was reproduced and is correct — the acceptance was
premature. Head `6c0ffb9` received a focused re-verification: **ACCEPT**
(69/69 tests, CI PASS run 42563370184). M03-1 is accepted pending owner
merge authorization per the dependency-safe sequence (rebase onto merged
M02 first).

## Non-blocking follow-ups (M03-2)

F-M03-01 webhook signature verification (pre-M05); F-M03-02
dispatcher/API wiring; F-M03-03 hash duplication; F-M03-04 quota fail-open
default (document or default-deny); F-M03-05 SQLite single-writer
assumption; `transition()` does not set `dispatched_at`/`completed_at`;
migration same-version-prefix collision + deleted-file detection; restore
stale `-wal`/`-shm`; `call.ringing` unmapped.

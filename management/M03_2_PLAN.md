# CALLFORGE OMEGA — M03-2 Durable Workflow Orchestration Plan

Date: 2026-11-09. Status: planned (BACKEND-ARCHITECT design, unimplemented).
Precondition: M03-1 merged; M02 merged first (server.mjs/store.mjs overlap).

## Components

1. **Outbox dispatcher loop** (`workflow/dispatcher.mjs`): serial poll,
   handler registry, `OUTBOX_DISPATCHER_ENABLED=1` gate. Sink handler is a
   no-op until M05 (no external side effects yet).
2. **Quota counters** (`workflow/quota.mjs`): atomic `consumeQuota` /
   `releaseQuota` (single guarded `UPDATE…RETURNING`); consume on intent
   creation inside the idempotent create transaction (no double-consume on
   replay); release on rejected/cancelled transitions.
3. **Retention deletes**: `planRetention` + chunked deletes (500 rows) behind
   double env gate (`RETENTION_ENABLED=1` and `RETENTION_DRY_RUN=0`);
   default is report-only.
4. **Webhook wiring** (`server.mjs`, post-M02): `POST /webhook/:provider`
   with HMAC-SHA256 signature check (401 + nothing stored on failure),
   202 on store, 200 on duplicate; dispatcher drives `received → processing
→ processed`.
5. **Reconciliation sweep** (`workflow/reconciler.mjs`): orphaned webhooks,
   stuck dispatched intents (report-only), dead-letter scan, quota drift —
   counts report, no forced transitions.
6. **Crash recovery** (`workflow/recovery.mjs`, in server initialize):
   expired-lease reclaim + processing-webhook reset; `/ready` 503 until done.

## Test plan

`tests/m03-orchestration.test.mjs`: backoff honored; dispatcher end-to-end
ack/fail; quota atomicity under parallel consume (exactly N succeed);
recovery resets; retention gating (both flags required); webhook HTTP
(valid→202, bad sig→401, duplicate→single row); reconciler counts.

## Acceptance

Crash-recovery proof, quota never over limit, retention never deletes
without both flags, `/ready` gating, timers don't block shutdown.

## Out of scope (M03-3+)

Multi-process workers, Postgres adapter, DLQ UI/alerting, per-provider
signature schemes, auto-healing stuck intents, billing ledger.

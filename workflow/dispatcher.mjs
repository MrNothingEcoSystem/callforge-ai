/**
 * CALLFORGE AI — Outbox dispatcher loop (M03-2)
 *
 * Serial poll: claimBatch → registry handler → ack/fail. The loop runs only
 * when OUTBOX_DISPATCHER_ENABLED=1. The default sink handler is a no-op log
 * until M05 (no external side effects yet). Timers never block shutdown:
 * stop() clears the interval immediately and in-flight rows keep their lease.
 *
 * Webhook lifecycle (F1): received → processing → processed, transactionally.
 * A crash between the processing write and the outbox ack leaves the row
 * claimed; lease expiry + recovery reset it to received for redelivery, and
 * the handler is idempotent (already-processed rows are a no-op).
 */
import { claimBatch, ack, fail } from './outbox.mjs';

export function createDispatcher(
  db,
  { handlers = {}, pollMs = 1000, limit = 10, workerId = 'dispatcher-1' } = {},
) {
  const registry = { 'webhook.received': handleWebhook, ...handlers };
  let timer = null;
  let stopped = false;

  /**
   * F1 lifecycle: received → processing → processed in one transaction.
   * Idempotent: a redelivery of an already-processed webhook is a no-op.
   * Throws on error so dispatchOnce() routes the outbox row through fail()
   * backoff; the 'processing' state is reset to 'received' by runRecovery()
   * on restart, and lease reclaim re-enqueues the outbox row.
   */
  function handleWebhook(db, row) {
    return db.transaction(() => {
      const wh = db.prepare('SELECT * FROM webhook_inbox WHERE id = ?').get(row.aggregate_id);
      if (!wh || wh.status === 'processed') {
        return { noop: true, already: wh?.status ?? 'missing' };
      }
      const mark = db
        .prepare(
          "UPDATE webhook_inbox SET status = 'processing' WHERE id = ? AND status IN ('received','processing')",
        )
        .run(row.aggregate_id);
      if (mark.changes === 0) {
        return { noop: true, already: 'raced' };
      }
      // Reconcile the stored provider event header, if present. Until M05
      // registers live providers there is no call_event mapping; completion
      // is still recorded so the lifecycle reaches 'processed'.
      db.prepare(
        `UPDATE webhook_inbox
         SET status = 'processed', processed_at = datetime('now'), last_error = NULL
         WHERE id = ?`,
      ).run(row.aggregate_id);
      return { completed: true };
    })();
  }

  async function dispatchOnce() {
    if (stopped || process.env.OUTBOX_DISPATCHER_ENABLED !== '1') {
      return { claimed: 0, acked: 0, failed: 0 };
    }
    const rows = claimBatch(db, { workerId, limit });
    let acked = 0;
    let failed = 0;
    for (const row of rows) {
      const handler = registry[row.type];
      try {
        if (handler) {
          await handler(db, row);
        } else {
          // Unknown type: no-op until M05 registers real sinks.
          console.log(`[dispatcher] no handler for ${row.type} (noop)`);
        }
        if (ack(db, row.id, workerId)) {
          acked += 1;
        }
      } catch (error) {
        if (fail(db, row.id, workerId, error)) {
          failed += 1;
        }
      }
    }
    return { claimed: rows.length, acked, failed };
  }

  /**
   * F6: lifecycle-safe. Safe to call repeatedly; re-checks the env gate on
   * every call so a late enable takes effect without a server restart.
   */
  function start() {
    if (process.env.OUTBOX_DISPATCHER_ENABLED !== '1') {
      return { started: false, reason: 'OUTBOX_DISPATCHER_ENABLED!=1' };
    }
    if (timer) {
      return { started: false, reason: 'already_running' };
    }
    stopped = false;
    timer = setInterval(() => {
      dispatchOnce().catch(error => console.error('[dispatcher]', error));
    }, pollMs);
    timer.unref();
    return { started: true, pollMs };
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return { stopped: true };
  }

  return {
    dispatchOnce,
    start,
    stop,
    get running() {
      return timer !== null;
    },
  };
}

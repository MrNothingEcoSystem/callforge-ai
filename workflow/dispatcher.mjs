/**
 * CALLFORGE AI — Outbox dispatcher loop (M03-2)
 *
 * Serial poll: claimBatch → registry handler → ack/fail. The loop runs only
 * when OUTBOX_DISPATCHER_ENABLED=1. The default sink handler is a no-op log
 * until M05 (no external side effects yet). Timers never block shutdown:
 * stop() clears the interval immediately and in-flight rows keep their lease.
 */
import { claimBatch, ack, fail } from './outbox.mjs';

export function createDispatcher(
  db,
  { handlers = {}, pollMs = 1000, limit = 10, workerId = 'dispatcher-1' } = {},
) {
  const registry = { 'webhook.received': handleWebhook, ...handlers };
  let timer = null;
  let stopped = false;

  function handleWebhook(db, row) {
    db.prepare(
      "UPDATE webhook_inbox SET status = 'processing' WHERE id = ? AND status = 'received'",
    ).run(row.aggregate_id);
    return { noop: true };
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

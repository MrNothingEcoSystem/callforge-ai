/**
 * CALLFORGE AI — Reconciliation sweep (M03-2)
 *
 * Report-only scan: orphaned webhooks, stuck dispatched intents,
 * dead-lettered outbox rows, quota drift. No forced transitions.
 */
export function runReconciler(db, { stuckMinutes = 60 } = {}) {
  const orphanedWebhooks = db
    .prepare(
      `SELECT COUNT(*) AS n FROM webhook_inbox w
       WHERE w.status IN ('received', 'processing')
         AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.aggregate_id = w.id)`,
    )
    .get().n;
  const stuckIntents = db
    .prepare(
      `SELECT COUNT(*) AS n FROM call_intents
       WHERE status = 'dispatched' AND updated_at < datetime('now', ?)`,
    )
    .get(`-${stuckMinutes} minutes`).n;
  const stuckWebhooks = db
    .prepare("SELECT COUNT(*) AS n FROM webhook_inbox WHERE status = 'processing'")
    .get().n;
  const deadLetters = db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead'").get().n;
  const pendingOutbox = db
    .prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'")
    .get().n;
  const quotaDrift = db
    .prepare('SELECT COUNT(*) AS n FROM tenant_quotas WHERE used > limit_value AND limit_value > 0')
    .get().n;
  return {
    orphaned_webhooks: orphanedWebhooks,
    stuck_webhooks: stuckWebhooks,
    stuck_dispatched_intents: stuckIntents,
    dead_letter_outbox: deadLetters,
    pending_outbox: pendingOutbox,
    quota_drift_tenants: quotaDrift,
  };
}

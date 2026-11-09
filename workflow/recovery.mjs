/**
 * CALLFORGE AI — Crash recovery (M03-2)
 *
 * Runs in server initialize: reclaims expired outbox leases (claimed rows
 * whose worker died return to pending for re-delivery) and resets
 * processing webhooks to received. /ready returns 503 until recovery is
 * marked complete by the caller.
 */
export function runRecovery(db) {
  const leaseReclaim = db
    .prepare(
      `UPDATE outbox SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
              lease_expires_at = NULL
       WHERE status = 'claimed' AND lease_expires_at IS NOT NULL
         AND lease_expires_at < datetime('now')`,
    )
    .run();
  const webhookReset = db
    .prepare("UPDATE webhook_inbox SET status = 'received' WHERE status = 'processing'")
    .run();
  return {
    reclaimed_leases: leaseReclaim.changes,
    reset_webhooks: webhookReset.changes,
  };
}

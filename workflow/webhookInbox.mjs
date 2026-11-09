/**
 * CALLFORGE AI — Webhook inbox + provider-event reconciliation (M03-1)
 *
 * Webhooks are stored first (dedup by provider + dedup_key) and an outbox
 * row is enqueued in the same transaction. Reconciliation maps provider
 * events onto the call-intent state machine; unknown or stale events are
 * recorded as rejected, never force-written.
 */
import { createHash } from 'node:crypto';
import { generateId } from '../store.mjs';
import { enqueue } from './outbox.mjs';
import { transition, InvalidTransitionError } from './stateMachine.mjs';

export function receiveWebhook(db, { provider, dedupKey, rawBody, signature = null }) {
  const key = dedupKey || createHash('sha256').update(`${provider}:${rawBody}`).digest('hex');
  const id = generateId();
  const store = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO webhook_inbox (id, provider, dedup_key, raw_body, signature)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, provider, key, rawBody, signature);
    const row = db
      .prepare('SELECT * FROM webhook_inbox WHERE provider = ? AND dedup_key = ?')
      .get(provider, key);
    if (row.id !== id) {
      return { row, stored: false };
    }
    enqueue(db, {
      tenantId: null, // system row; tenant resolved at reconciliation
      aggregateType: 'webhook',
      aggregateId: id,
      type: 'webhook.received',
      payload: { provider, dedup_key: key },
      dedupKey: `webhook:${provider}:${key}`,
    });
    return { row, stored: true };
  });
  return store();
}

const PROVIDER_EVENT_MAP = {
  'call.answered': 'dispatched',
  'call.completed': 'completed',
  'call.failed': 'failed',
  'call.cancelled': 'cancelled',
};

export function reconcileProviderEvent(
  db,
  { provider, providerEventId, callIntentId, eventType, payload = {} },
) {
  const id = generateId();
  const stored = db
    .prepare(
      `INSERT OR IGNORE INTO provider_events (id, provider, provider_event_id, call_intent_id, event_type, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, provider, providerEventId, callIntentId || null, eventType, JSON.stringify(payload));
  if (stored.changes === 0) {
    return { applied: false, ignored_duplicate: true, ignored_stale: false };
  }
  const target = PROVIDER_EVENT_MAP[eventType];
  if (!target || !callIntentId) {
    return {
      applied: false,
      ignored_duplicate: false,
      ignored_stale: true,
      reason: 'unmapped event',
    };
  }
  try {
    const result = transition(db, {
      intentId: callIntentId,
      to: target,
      actor: 'provider',
      payload: { provider, providerEventId },
    });
    return { applied: true, ignored_duplicate: false, ignored_stale: false, ...result };
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return {
        applied: false,
        ignored_duplicate: false,
        ignored_stale: true,
        reason: error.message,
      };
    }
    throw error;
  }
}

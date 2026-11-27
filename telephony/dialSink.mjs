/**
 * CALLFORGE AI — `call.dial` sink (M05 / TECH-015)
 *
 * Consumes the outbox row the M04 gate enqueues on an allow. This closes the gap
 * the dial gate left: until now `call.dial` had no handler and was acked as a
 * no-op, so an allowed dial was authorised and then forgotten.
 *
 * Ordering is deliberate. The attempt row is written *before* the provider is
 * called, so a crash mid-dial still leaves evidence and the lease-expiry retry
 * sees it. The unique `dial_request_id` makes redelivery safe: a redelivery of an
 * accepted attempt is a no-op rather than a second call. Only a thrown provider
 * error leaves the row for the dispatcher's backoff (`failed` + rethrow); the
 * gate is not re-evaluated here — the decision was snapshotted and stands.
 *
 * The intent is moved approved → dispatched only on provider acceptance, and only
 * if it is still `approved` (a cancelled intent is not resurrected).
 */
import { generateId } from '../store.mjs';
import { transition } from '../workflow/stateMachine.mjs';
import { resolveProvider } from './provider.mjs';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ payload: string | object }} row outbox row; payload.dialRequestId is the subject
 * @param {{ provider?: { name: string, dial: Function } }} [options]
 */
export async function handleCallDial(db, row, { provider } = {}) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (!payload?.dialRequestId) {
    return { noop: true, reason: 'payload_missing_dial_request' };
  }
  const request = /** @type {any} */ (
    db.prepare('SELECT * FROM dial_requests WHERE id = ?').get(payload.dialRequestId)
  );
  if (!request) {
    return { noop: true, reason: 'dial_request_missing' };
  }
  // A denied or still-pending decision has nothing to dial; only an allow is a
  // licence to reach a carrier.
  if (request.status !== 'allowed') {
    return { noop: true, reason: `dial_request_${request.status}` };
  }
  const adapter = provider ?? resolveProvider();
  const prior = /** @type {any} */ (
    db.prepare('SELECT * FROM call_attempts WHERE dial_request_id = ?').get(request.id)
  );
  if (prior?.status === 'accepted') {
    return { noop: true, reason: 'already_accepted', attemptId: prior.id };
  }
  const attempt = db.transaction(() => {
    if (prior) {
      db.prepare(
        `UPDATE call_attempts
         SET status = 'dispatching', attempts = attempts + 1, error = NULL,
             provider = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(adapter.name, prior.id);
      return { id: prior.id };
    }
    const id = generateId();
    db.prepare(
      `INSERT INTO call_attempts
         (id, tenant_id, dial_request_id, call_intent_id, provider, attempts)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(id, request.tenant_id, request.id, request.call_intent_id, adapter.name);
    return { id };
  })();

  let handle;
  try {
    handle = await adapter.dial({
      idempotencyKey: request.id,
      dialRequestId: request.id,
      callIntentId: request.call_intent_id,
      tenantId: request.tenant_id,
      to: request.phone,
      from: request.cli,
      campaignKind: request.campaign_kind,
    });
  } catch (error) {
    db.prepare(
      `UPDATE call_attempts SET status = 'failed', error = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(String(error?.message ?? error), attempt.id);
    throw error;
  }
  if (!handle?.providerRef) {
    // A provider that resolves without a handle is treated as a failure, not a
    // success: there would be no way to correlate the later webhook.
    const error = new Error(`provider "${adapter.name}" returned no providerRef`);
    db.prepare(
      `UPDATE call_attempts SET status = 'failed', error = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(error.message, attempt.id);
    throw error;
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE call_attempts SET status = 'accepted', provider_ref = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(handle.providerRef, attempt.id);
    const intent = /** @type {any} */ (
      db.prepare('SELECT status FROM call_intents WHERE id = ?').get(request.call_intent_id)
    );
    if (intent?.status === 'approved') {
      transition(db, {
        intentId: request.call_intent_id,
        to: 'dispatched',
        actor: `telephony:${adapter.name}`,
        reason: `dial accepted by provider (${handle.providerRef})`,
        payload: { attemptId: attempt.id, providerRef: handle.providerRef },
      });
    }
  })();

  return { accepted: true, attemptId: attempt.id, providerRef: handle.providerRef };
}

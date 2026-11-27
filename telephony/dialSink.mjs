/**
 * CALLFORGE AI — `call.dial` sink (M05 / TECH-015)
 *
 * Consumes the outbox row the M04 gate enqueues on an allow. This closes the gap
 * the dial gate left: until now `call.dial` had no handler and was acked as a
 * no-op, so an allowed dial was authorised and then forgotten.
 *
 * Ordering is deliberate. The attempt row is *claimed* and written *before* the
 * provider is called, so a crash mid-dial still leaves evidence and the
 * lease-expiry retry sees it. The unique `dial_request_id` makes redelivery safe:
 * a redelivery of an accepted attempt is a no-op rather than a second call.
 *
 * Concurrency (TECH-015 F3): two dispatcher workers can race the same row. The
 * claim is a compare-and-set on `status`/`claimed_at` inside an IMMEDIATE
 * transaction, so only one worker proceeds; the loser no-ops as
 * `already_dispatching`. The claim carries a `claim_token` (fencing token) and
 * every terminal write is fenced on it, so a worker whose lease expired cannot
 * overwrite the row its replacement now owns. A `dispatching` row older than
 * `CLAIM_LEASE_SECONDS` is reclaimable — a dead worker does not wedge the attempt,
 * and the provider idempotency key is the last line of defence for the rare
 * slow-but-alive overlap.
 *
 * Only a thrown provider error leaves the row for the dispatcher's backoff
 * (`failed` + rethrow); the gate is not re-evaluated here — the decision was
 * snapshotted and stands.
 *
 * The intent is moved approved → dispatched only on provider acceptance, only if
 * it is still `approved` (a cancelled intent is not resurrected), and only by the
 * worker that still holds the claim.
 */
import { generateId } from '../store.mjs';
import { transition } from '../workflow/stateMachine.mjs';
import { resolveProvider } from './provider.mjs';

/** Seconds a `dispatching` claim stays valid before another worker may take it. */
export const CLAIM_LEASE_SECONDS = 300;

/**
 * CAS-claim the attempt row for this dial request.
 * @returns {{ id: string, token: string } | { noop: string, attemptId?: string }}
 */
function claimAttempt(db, request, providerName) {
  // IMMEDIATE so the read/CAS pair cannot interleave with another process's write.
  return db
    .transaction(() => {
      const prior = /** @type {any} */ (
        db.prepare('SELECT * FROM call_attempts WHERE dial_request_id = ?').get(request.id)
      );
      if (prior?.status === 'accepted') {
        return { noop: 'already_accepted', attemptId: prior.id };
      }
      const token = generateId();
      if (!prior) {
        const id = generateId();
        db.prepare(
          `INSERT INTO call_attempts
           (id, tenant_id, dial_request_id, call_intent_id, provider, attempts, status,
            claim_token, claimed_at)
         VALUES (?, ?, ?, ?, ?, 1, 'dispatching', ?, datetime('now'))`,
        ).run(id, request.tenant_id, request.id, request.call_intent_id, providerName, token);
        return { id, token };
      }
      // A live claim belongs to someone else; a lease-expired one is ours to take.
      const info = db
        .prepare(
          `UPDATE call_attempts
            SET status = 'dispatching', attempts = attempts + 1, error = NULL,
                provider = ?, claim_token = ?, claimed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?
            AND (status = 'failed'
                 OR claimed_at IS NULL
                 OR claimed_at <= datetime('now', ?))`,
        )
        .run(providerName, token, prior.id, `-${CLAIM_LEASE_SECONDS} seconds`);
      if (info.changes === 0) {
        return { noop: 'already_dispatching', attemptId: prior.id };
      }
      return { id: prior.id, token };
    })
    .immediate();
}

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

  const claim = claimAttempt(db, request, adapter.name);
  if ('noop' in claim) {
    return { noop: true, reason: claim.noop, attemptId: claim.attemptId };
  }
  const attempt = { id: claim.id };

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
      `UPDATE call_attempts
          SET status = 'failed', error = ?, claim_token = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?`,
    ).run(String(error?.message ?? error), attempt.id, claim.token);
    throw error;
  }
  if (!handle?.providerRef) {
    // A provider that resolves without a handle is treated as a failure, not a
    // success: there would be no way to correlate the later webhook.
    const error = new Error(`provider "${adapter.name}" returned no providerRef`);
    db.prepare(
      `UPDATE call_attempts
          SET status = 'failed', error = ?, claim_token = NULL, updated_at = datetime('now')
        WHERE id = ? AND claim_token = ?`,
    ).run(error.message, attempt.id, claim.token);
    throw error;
  }

  const won = db
    .transaction(() => {
      const info = db
        .prepare(
          `UPDATE call_attempts
            SET status = 'accepted', provider_ref = ?, claim_token = NULL,
                claimed_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND claim_token = ?`,
        )
        .run(handle.providerRef, attempt.id, claim.token);
      if (info.changes === 0) {
        // Superseded mid-flight: the new owner keeps the row, we already dialled.
        return false;
      }
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
      return true;
    })
    .immediate();

  return {
    accepted: true,
    attemptId: attempt.id,
    providerRef: handle.providerRef,
    superseded: !won,
  };
}

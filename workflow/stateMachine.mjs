/**
 * CALLFORGE AI — Call-intent state machine (M03-1)
 *
 * The ONLY writer of call_intents.status. Every transition is validated,
 * optimistic-guarded (expected current status), and written atomically
 * with its call_event, outbox row, transition record, and audit row.
 */
import { createHash } from 'node:crypto';
import { generateId } from '../store.mjs';
import { enqueue } from './outbox.mjs';

export const STATES = [
  'pending',
  'approved',
  'rejected',
  'dispatched',
  'completed',
  'failed',
  'cancelled',
];

export const TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['dispatched', 'cancelled'],
  dispatched: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  rejected: [],
  cancelled: [],
};

export class InvalidTransitionError extends Error {}
export class StaleStateError extends Error {}

export function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

function hashEventSync(event) {
  const sorted = {};
  for (const key of Object.keys(event).sort()) {
    sorted[key] = event[key];
  }
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export function transition(db, { intentId, to, actor = 'system', reason = null, payload = {} }) {
  const intent = db.prepare('SELECT * FROM call_intents WHERE id = ?').get(intentId);
  if (!intent) {
    throw new Error(`Call intent not found: ${intentId}`);
  }
  const from = intent.status;
  if (!canTransition(from, to)) {
    db.prepare(
      `INSERT INTO call_state_transitions (id, call_intent_id, from_state, to_state, actor, result, reason)
       VALUES (?, ?, ?, ?, ?, 'rejected', ?)`,
    ).run(generateId(), intentId, from, to, actor, reason || 'invalid transition');
    throw new InvalidTransitionError(`Cannot transition ${from} -> ${to}`);
  }

  const apply = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE call_intents SET status = ?, updated_at = datetime('now')
         WHERE id = ? AND status = ?`,
      )
      .run(to, intentId, from);
    if (updated.changes !== 1) {
      throw new StaleStateError(`Call intent ${intentId} changed concurrently`);
    }

    const seqRow = db
      .prepare('SELECT MAX(sequence_number) AS m FROM call_events WHERE call_intent_id = ?')
      .get(intentId);
    const sequence = (seqRow.m || 0) + 1;
    const prev = db
      .prepare(
        'SELECT event_hash FROM call_events WHERE call_intent_id = ? ORDER BY sequence_number DESC LIMIT 1',
      )
      .get(intentId);
    const event = {
      id: generateId(),
      call_intent_id: intentId,
      event_type: 'state_transition',
      payload: { from, to, actor, reason, ...payload },
      sequence_number: sequence,
      previous_event_hash: prev ? prev.event_hash : null,
      created_at: new Date().toISOString(),
    };
    event.event_hash = hashEventSync(event);
    db.prepare(
      `INSERT INTO call_events (id, call_intent_id, event_type, payload, sequence_number, previous_event_hash, event_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      intentId,
      event.event_type,
      JSON.stringify(event.payload),
      sequence,
      event.previous_event_hash,
      event.event_hash,
    );

    db.prepare(
      `INSERT INTO call_state_transitions (id, call_intent_id, from_state, to_state, actor, result, reason)
       VALUES (?, ?, ?, ?, ?, 'applied', ?)`,
    ).run(generateId(), intentId, from, to, actor, reason);

    enqueue(db, {
      tenantId: intent.tenant_id,
      aggregateType: 'call_intent',
      aggregateId: intentId,
      type: 'call_intent.transitioned',
      payload: { from, to, actor },
      dedupKey: `transition:${intentId}:${sequence}`,
    });

    const chainHead = db
      .prepare('SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1')
      .get();
    const auditEvent = {
      id: generateId(),
      tenant_id: intent.tenant_id,
      event_type: 'call_state_transition',
      actor_type: 'system',
      action: 'transition_call_intent',
      resource_type: 'call_intent',
      resource_id: intentId,
      payload: { from, to, actor, reason },
      previous_hash: chainHead ? chainHead.event_hash : null,
      created_at: new Date().toISOString(),
    };
    auditEvent.event_hash = hashEventSync(auditEvent);
    db.prepare(
      `INSERT INTO audit_events (id, tenant_id, event_type, actor_type, action, resource_type, resource_id, payload, previous_hash, event_hash)
       VALUES (?, ?, ?, 'system', ?, ?, ?, ?, ?, ?)`,
    ).run(
      auditEvent.id,
      intent.tenant_id,
      auditEvent.event_type,
      auditEvent.action,
      auditEvent.resource_type,
      auditEvent.resource_id,
      JSON.stringify(auditEvent.payload),
      auditEvent.previous_hash,
      auditEvent.event_hash,
    );

    return { from, to, sequence };
  });

  return apply();
}

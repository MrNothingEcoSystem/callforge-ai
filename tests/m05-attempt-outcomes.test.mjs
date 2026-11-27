import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
process.env.OUTBOX_DISPATCHER_ENABLED = '1';
import { requestDial, dispatchDialRequest, readAttempts } from '../workflow/dialGate.mjs';
import { handleCallDial } from '../telephony/dialSink.mjs';
import { recordAttemptOutcome, KNOWN_OUTCOMES } from '../workflow/attemptOutcomes.mjs';
import { reconcileProviderEvent } from '../workflow/webhookInbox.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m05-outcome-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');
const NOW = new Date('2026-11-26T07:00:00Z');

const POLICY = {
  licensed: true,
  approvalRef: 'TDRA-REF-1',
  approvalExpiresAt: new Date('2027-01-01T00:00:00Z'),
  cliInventory: ['+971500000001'],
};
const CONTACT = {
  phone: '+971500000002',
  consent: { withdrawn: false, purpose: 'renewal' },
  dncrStatus: 'clean',
  dncrCheckedAt: new Date('2026-11-26T05:00:00Z'),
};
const CAMPAIGN = { kind: 'marketing', cli: '+971500000001', purpose: 'renewal' };

const provider = {
  name: 'fake',
  calls: [],
  async dial(args) {
    provider.calls.push(args);
    return { providerRef: `fake-${args.idempotencyKey}` };
  },
};

let seq = 0;

function seed(db) {
  const tenantId = generateId();
  db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantId, 'T', '{}');
  const intentId = generateId();
  db.prepare(
    'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
  ).run(intentId, tenantId, `intent-${intentId}`, 'outbound', 'approved');
  seq += 1;
  return { tenantId, callIntentId: intentId, idempotencyKey: `dial-${seq}` };
}

/** A request driven all the way to an accepted carrier attempt. */
async function dialled(db) {
  const ids = seed(db);
  const { request } = requestDial(db, {
    ...ids,
    campaign: CAMPAIGN,
    contact: CONTACT,
    policy: POLICY,
    now: NOW,
  });
  dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
  const row = db
    .prepare("SELECT * FROM outbox WHERE type = 'call.dial' AND dedup_key = ?")
    .get(`call.dial:${request.id}`);
  await handleCallDial(db, row, { provider });
  return { ...ids, request, providerRef: `fake-${request.id}` };
}

const attemptRow = (db, requestId) =>
  db.prepare('SELECT * FROM call_attempts WHERE dial_request_id = ?').get(requestId);

describe('M05 attempt outcomes (TECH-016)', () => {
  let db;

  beforeAll(async () => {
    setTestDatabasePath(DB_PATH);
    const { initDatabase } = await import('../store.mjs');
    await initDatabase();
    db = getDatabase();
  });

  afterAll(async () => {
    await closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.exec(
      'DELETE FROM call_attempts; DELETE FROM provider_events; DELETE FROM webhook_inbox; DELETE FROM outbox; DELETE FROM dial_requests; DELETE FROM call_intents; DELETE FROM tenants;',
    );
    provider.calls.length = 0;
  });

  it('records an answered outcome on the attempt the provider ref points at', async () => {
    const { request, providerRef } = await dialled(db);
    const result = recordAttemptOutcome(db, {
      provider: 'fake',
      providerRef,
      outcome: 'answered',
      durationSeconds: 42,
    });
    expect(result).toMatchObject({ recorded: true, outcome: 'answered' });
    const row = attemptRow(db, request.id);
    expect(row.outcome).toBe('answered');
    expect(row.duration_seconds).toBe(42);
    expect(row.outcome_at).toBeTruthy();
  });

  it('counts an unanswered call against the ceiling and an answered one does not', async () => {
    const first = await dialled(db);
    expect(
      readAttempts(db, { tenantId: first.tenantId, phone: CONTACT.phone, now: NOW })[0].outcome,
    ).toBe('no_answer');
    recordAttemptOutcome(db, {
      provider: 'fake',
      providerRef: first.providerRef,
      outcome: 'answered',
    });
    expect(
      readAttempts(db, { tenantId: first.tenantId, phone: CONTACT.phone, now: NOW })[0].outcome,
    ).toBe('answered');

    const second = await dialled(db);
    recordAttemptOutcome(db, {
      provider: 'fake',
      providerRef: second.providerRef,
      outcome: 'no_answer',
    });
    expect(
      readAttempts(db, { tenantId: second.tenantId, phone: CONTACT.phone, now: NOW })[0].outcome,
    ).toBe('no_answer');
  });

  it('leaves the outcome null when nothing has been reported (late webhook)', async () => {
    const { request } = await dialled(db);
    expect(attemptRow(db, request.id).outcome).toBeNull();
    expect(
      readAttempts(db, { tenantId: request.tenant_id, phone: CONTACT.phone, now: NOW })[0].outcome,
    ).toBe('no_answer');
  });

  it('rejects an unknown outcome string without touching the row', async () => {
    const { request, providerRef } = await dialled(db);
    const result = recordAttemptOutcome(db, { provider: 'fake', providerRef, outcome: 'hung_up' });
    expect(result).toEqual({ recorded: false, reason: 'unknown_outcome' });
    expect(attemptRow(db, request.id).outcome).toBeNull();
    expect(KNOWN_OUTCOMES.has('hung_up')).toBe(false);
  });

  it('reports an unknown attempt and a missing correlation rather than creating one', async () => {
    expect(
      recordAttemptOutcome(db, { provider: 'fake', providerRef: 'nope', outcome: 'answered' }),
    ).toEqual({
      recorded: false,
      reason: 'unknown_attempt',
    });
    expect(recordAttemptOutcome(db, { provider: 'fake', outcome: 'answered' })).toEqual({
      recorded: false,
      reason: 'missing_correlation',
    });
    expect(db.prepare('SELECT COUNT(*) c FROM call_attempts').get().c).toBe(0);
  });

  it('is first-wins: a redelivered event cannot rewrite the outcome, but may fill a duration', async () => {
    const { providerRef } = await dialled(db);
    recordAttemptOutcome(db, { provider: 'fake', providerRef, outcome: 'answered' });
    const again = recordAttemptOutcome(db, { provider: 'fake', providerRef, outcome: 'no_answer' });
    expect(again).toMatchObject({
      recorded: false,
      reason: 'outcome_already_set',
      outcome: 'answered',
    });
    const filled = recordAttemptOutcome(db, {
      provider: 'fake',
      providerRef,
      outcome: 'answered',
      durationSeconds: 9,
    });
    expect(filled).toMatchObject({ recorded: true, refined: 'duration' });
    const row = db.prepare('SELECT * FROM call_attempts WHERE provider_ref = ?').get(providerRef);
    expect(row.outcome).toBe('answered');
    expect(row.duration_seconds).toBe(9);
  });

  it('scopes the correlation by provider, so a same-ref event from another carrier misses', async () => {
    const { request, providerRef } = await dialled(db);
    expect(
      recordAttemptOutcome(db, { provider: 'other', providerRef, outcome: 'answered' }).recorded,
    ).toBe(false);
    expect(attemptRow(db, request.id).outcome).toBeNull();
  });

  it('captures the outcome through a provider webhook even when the intent transition is stale', async () => {
    const { request, callIntentId, providerRef } = await dialled(db);
    // Force the intent to a terminal state so the transition is refused…
    db.prepare("UPDATE call_intents SET status = 'completed' WHERE id = ?").run(callIntentId);
    const result = reconcileProviderEvent(db, {
      provider: 'fake',
      providerEventId: 'evt-1',
      callIntentId,
      eventType: 'call.completed',
      payload: { outcome: 'ended_unanswered', providerRef },
    });
    // …the state machine records it as stale, the attempt still gets the outcome.
    expect(result.applied).toBe(false);
    expect(result.ignored_stale).toBe(true);
    expect(attemptRow(db, request.id).outcome).toBe('ended_unanswered');
  });

  it('uses the provider timestamp when supplied and does not double-apply a duplicate event', async () => {
    const { request, callIntentId, providerRef } = await dialled(db);
    const when = '2026-11-26T07:01:30Z';
    db.prepare("UPDATE call_intents SET status = 'dispatched' WHERE id = ?").run(callIntentId);
    const args = {
      provider: 'fake',
      providerEventId: 'evt-2',
      callIntentId,
      eventType: 'call.answered',
      payload: { outcome: 'answered', providerRef, occurredAt: when },
    };
    reconcileProviderEvent(db, args);
    const duplicate = reconcileProviderEvent(db, args);
    expect(duplicate.ignored_duplicate).toBe(true);
    expect(attemptRow(db, request.id).outcome_at).toBe(when);
  });
});

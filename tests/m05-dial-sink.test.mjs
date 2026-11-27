import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
process.env.OUTBOX_DISPATCHER_ENABLED = '1';
import { requestDial, dispatchDialRequest } from '../workflow/dialGate.mjs';
import { createDispatcher } from '../workflow/dispatcher.mjs';
import { handleCallDial } from '../telephony/dialSink.mjs';
import { resolveProvider, registerProvider, UnknownProviderError } from '../telephony/provider.mjs';
import { simulatedProvider } from '../telephony/simulatedProvider.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m05-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');
const NOW = new Date('2026-11-26T07:00:00Z'); // 11:00 Dubai, inside the window

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

/** Controllable adapter: records calls, rejects on demand. */
function fakeProvider() {
  const provider = {
    name: 'fake',
    calls: [],
    failNext: 0,
    async dial(args) {
      provider.calls.push(args);
      if (provider.failNext > 0) {
        provider.failNext -= 1;
        throw new Error('carrier said no');
      }
      return { providerRef: `fake-${args.idempotencyKey}` };
    },
  };
  return provider;
}

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

/** Drive a request up to an allowed one, exactly as the gate would. */
function allowed(db) {
  const ids = seed(db);
  const { request } = requestDial(db, {
    ...ids,
    campaign: CAMPAIGN,
    contact: CONTACT,
    policy: POLICY,
    now: NOW,
  });
  dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
  return { ...ids, request };
}

function dialRow(db, requestId) {
  return db
    .prepare("SELECT * FROM outbox WHERE type = 'call.dial' AND dedup_key = ?")
    .get(`call.dial:${requestId}`);
}

const attempt = (db, requestId) =>
  db.prepare('SELECT * FROM call_attempts WHERE dial_request_id = ?').get(requestId);

describe('M05 call.dial sink (TECH-015)', () => {
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
      'DELETE FROM call_attempts; DELETE FROM outbox; DELETE FROM dial_requests; DELETE FROM call_intents; DELETE FROM tenants;',
    );
    simulatedProvider.queuedFailures = 0;
    simulatedProvider.calls.length = 0;
  });

  it('dials through the provider, records the attempt and dispatches the intent', async () => {
    const provider = fakeProvider();
    const { request, callIntentId } = allowed(db);
    const result = await handleCallDial(db, dialRow(db, request.id), { provider });

    expect(result.accepted).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      idempotencyKey: request.id,
      to: CONTACT.phone,
      from: CAMPAIGN.cli,
      tenantId: request.tenant_id,
    });
    const row = attempt(db, request.id);
    expect(row.status).toBe('accepted');
    expect(row.provider_ref).toBe(`fake-${request.id}`);
    expect(row.tenant_id).toBe(request.tenant_id);
    expect(
      db.prepare('SELECT status FROM call_intents WHERE id = ?').get(callIntentId).status,
    ).toBe('dispatched');
  });

  it('is a no-op on redelivery of an accepted attempt (no second call)', async () => {
    const provider = fakeProvider();
    const { request } = allowed(db);
    const row = dialRow(db, request.id);
    await handleCallDial(db, row, { provider });
    const again = await handleCallDial(db, row, { provider });

    expect(again).toMatchObject({ noop: true, reason: 'already_accepted' });
    expect(provider.calls).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) c FROM call_attempts').get().c).toBe(1);
  });

  it('records a rejection, leaves it failed and rethrows for outbox backoff', async () => {
    const provider = fakeProvider();
    provider.failNext = 1;
    const { request, callIntentId } = allowed(db);

    await expect(handleCallDial(db, dialRow(db, request.id), { provider })).rejects.toThrow(
      'carrier said no',
    );
    const row = attempt(db, request.id);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('carrier said no');
    expect(
      db.prepare('SELECT status FROM call_intents WHERE id = ?').get(callIntentId).status,
    ).toBe('approved');

    // Retry reuses the row and, on acceptance, dispatches.
    await handleCallDial(db, dialRow(db, request.id), { provider });
    expect(attempt(db, request.id).status).toBe('accepted');
    expect(attempt(db, request.id).attempts).toBe(2);
    expect(
      db.prepare('SELECT status FROM call_intents WHERE id = ?').get(callIntentId).status,
    ).toBe('dispatched');
  });

  it('treats a handle-less resolution as a failure', async () => {
    const provider = { name: 'silent', async dial() {} };
    const { request } = allowed(db);
    await expect(handleCallDial(db, dialRow(db, request.id), { provider })).rejects.toThrow(
      'returned no providerRef',
    );
    expect(attempt(db, request.id).status).toBe('failed');
  });

  it('does not resurrect a cancelled intent but still records the attempt', async () => {
    const provider = fakeProvider();
    const { request, callIntentId } = allowed(db);
    db.prepare("UPDATE call_intents SET status = 'cancelled' WHERE id = ?").run(callIntentId);
    const result = await handleCallDial(db, dialRow(db, request.id), { provider });
    expect(result.accepted).toBe(true);
    expect(
      db.prepare('SELECT status FROM call_intents WHERE id = ?').get(callIntentId).status,
    ).toBe('cancelled');
  });

  it('no-ops on a missing payload or missing dial request', async () => {
    expect(await handleCallDial(db, { payload: '{}' })).toMatchObject({
      noop: true,
      reason: 'payload_missing_dial_request',
    });
    expect(
      await handleCallDial(
        db,
        { payload: { dialRequestId: 'nope' } },
        { provider: fakeProvider() },
      ),
    ).toMatchObject({ noop: true, reason: 'dial_request_missing' });
  });

  it('runs inside dispatchOnce and acks the row only on success', async () => {
    const provider = fakeProvider();
    const { request } = allowed(db);
    const dispatcher = createDispatcher(db, { provider, limit: 5 });
    // The gate row was already consumed by allowed(); isolate the sink row.
    db.prepare("DELETE FROM outbox WHERE type = 'dial.requested'").run();

    expect(await dispatcher.dispatchOnce()).toMatchObject({ claimed: 1, acked: 1, failed: 0 });
    expect(attempt(db, request.id).status).toBe('accepted');

    provider.failNext = 1;
    const second = allowed(db);
    db.prepare("DELETE FROM outbox WHERE type = 'dial.requested'").run();
    const result = await dispatcher.dispatchOnce();
    // The first accept also enqueued a `call_intent.transitioned` row (no handler
    // yet), so assert on the dial outcome rather than raw totals.
    expect(result.failed).toBe(1);
    expect(provider.calls).toHaveLength(2);
    expect(attempt(db, second.request.id).status).toBe('failed');
    expect(dialRow(db, second.request.id).status).toBe('pending');
  });

  it('resolves providers fail-closed and defaults to the inert simulated one', () => {
    expect(resolveProvider().name).toBe('simulated');
    expect(resolveProvider('simulated').name).toBe('simulated');
    expect(() => resolveProvider('nope')).toThrow(UnknownProviderError);
    registerProvider({ name: 'nope', dial: async () => ({ providerRef: 'x' }) });
    expect(resolveProvider('nope').name).toBe('nope');
  });

  it('uses the simulated provider end to end without touching the network', async () => {
    const { request, callIntentId } = allowed(db);
    const result = await handleCallDial(db, dialRow(db, request.id));
    expect(result.accepted).toBe(true);
    expect(simulatedProvider.calls).toHaveLength(1);
    expect(
      db.prepare('SELECT status FROM call_intents WHERE id = ?').get(callIntentId).status,
    ).toBe('dispatched');
  });
});

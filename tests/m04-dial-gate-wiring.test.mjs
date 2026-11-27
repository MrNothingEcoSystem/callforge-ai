import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { requestDial, dispatchDialRequest, readAttempts } from '../workflow/dialGate.mjs';
import { createDispatcher } from '../workflow/dispatcher.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m04w-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');
// 11:00 Asia/Dubai on a Thursday — inside the 09:00–18:00 window.
const NOW = new Date('2026-11-26T07:00:00Z');

const POLICY = {
  licensed: true,
  approvalRef: 'TDRA-REF-1',
  approvalExpiresAt: new Date('2027-01-01T00:00:00Z'),
  cliInventory: ['+971501234567'],
};
const CONTACT = {
  phone: '+971509876543',
  consent: { withdrawn: false, purpose: 'renewal' },
  dncrStatus: 'clean',
  dncrCheckedAt: new Date('2026-11-26T05:00:00Z'),
};
const CAMPAIGN = { kind: 'marketing', cli: '+971501234567', purpose: 'renewal' };

let seq = 0;

function tenant(db) {
  const tenantId = generateId();
  db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantId, 'T', '{}');
  return tenantId;
}

function seed(db, existingTenant = null) {
  const tenantId = existingTenant ?? tenant(db);
  const intentId = generateId();
  db.prepare(
    'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
  ).run(intentId, tenantId, `intent-${intentId}`, 'outbound', 'approved');
  seq += 1;
  return { tenantId, callIntentId: intentId, idempotencyKey: `dial-${seq}` };
}

function raise(db, overrides = {}) {
  const ids = seed(db, overrides.tenantId);
  const { request } = requestDial(db, {
    ...ids,
    campaign: overrides.campaign ?? CAMPAIGN,
    contact: overrides.contact ?? CONTACT,
    policy: overrides.policy ?? POLICY,
    now: overrides.now ?? NOW,
  });
  return { ...ids, request };
}

const dialRows = db =>
  db.prepare("SELECT * FROM outbox WHERE type = 'call.dial' ORDER BY created_at").all();

describe('M04 dial gate wiring (TECH-011)', () => {
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
      'DELETE FROM outbox; DELETE FROM dial_requests; DELETE FROM call_intents; DELETE FROM tenants;',
    );
  });

  it('requestDial snapshots the request and queues dial.requested only', () => {
    const { request } = raise(db);
    const stored = db.prepare('SELECT * FROM dial_requests WHERE id = ?').get(request.id);
    expect(stored.status).toBe('pending');
    expect(stored.phone).toBe(CONTACT.phone);
    expect(JSON.parse(stored.contact_json).dncrStatus).toBe('clean');
    expect(dialRows(db)).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) c FROM outbox WHERE type = 'dial.requested'").get().c).toBe(
      1,
    );
  });

  it('requestDial is idempotent on tenant + idempotency key', () => {
    const ids = seed(db);
    const first = requestDial(db, { ...ids, campaign: CAMPAIGN, contact: CONTACT, policy: POLICY });
    const second = requestDial(db, {
      ...ids,
      campaign: CAMPAIGN,
      contact: CONTACT,
      policy: POLICY,
    });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    expect(db.prepare('SELECT COUNT(*) c FROM dial_requests').get().c).toBe(1);
  });

  it('requires tenant, intent and idempotency key', () => {
    expect(() => requestDial(db, { campaign: CAMPAIGN, contact: CONTACT })).toThrow(TypeError);
  });

  it('rejects a missing intent and one owned by another tenant (review F1)', () => {
    const ids = seed(db);
    expect(() =>
      requestDial(db, { ...ids, callIntentId: 'nope', campaign: CAMPAIGN, contact: CONTACT }),
    ).toThrow(ReferenceError);
    const otherTenant = seed(db).tenantId;
    expect(() =>
      requestDial(db, {
        ...ids,
        tenantId: otherTenant,
        campaign: CAMPAIGN,
        contact: CONTACT,
      }),
    ).toThrow(RangeError);
    expect(db.prepare('SELECT COUNT(*) c FROM dial_requests').get().c).toBe(0);
  });

  it('allows and enqueues exactly one call.dial with the snapshot', () => {
    const { request } = raise(db);
    const result = dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
    expect(result.allowed).toBe(true);
    expect(db.prepare('SELECT status FROM dial_requests WHERE id = ?').get(request.id).status).toBe(
      'allowed',
    );
    const dials = dialRows(db);
    expect(dials).toHaveLength(1);
    expect(JSON.parse(dials[0].payload)).toMatchObject({
      dialRequestId: request.id,
      phone: CONTACT.phone,
      cli: CAMPAIGN.cli,
      campaignKind: 'marketing',
    });
  });

  it('denies with rule reasons and no call.dial row', () => {
    const { request } = raise(db, { contact: { ...CONTACT, consent: undefined } });
    const result = dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.reasons.map(r => r.code)).toContain('r05_consent_missing');
    expect(dialRows(db)).toHaveLength(0);
    const stored = db
      .prepare('SELECT status, reasons_json FROM dial_requests WHERE id = ?')
      .get(request.id);
    expect(stored.status).toBe('denied');
    expect(JSON.parse(stored.reasons_json)[0].rule).toBe('R05');
  });

  it('is a no-op on redelivery and on unknown requests', () => {
    const { request } = raise(db);
    dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
    expect(dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW })).toEqual({
      noop: true,
      status: 'allowed',
    });
    expect(dispatchDialRequest(db, { aggregate_id: 'missing' }, { now: NOW })).toEqual({
      noop: true,
      status: 'missing',
    });
    expect(dialRows(db)).toHaveLength(1);
  });

  it('denies outside the calling window', () => {
    const { request } = raise(db);
    const result = dispatchDialRequest(
      db,
      { aggregate_id: request.id },
      {
        now: new Date('2026-11-26T04:30:00Z'), // 08:30 Dubai
      },
    );
    expect(result.reasons.map(r => r.code)).toContain('r08_outside_window');
  });

  it('denies an expired competent-authority approval', () => {
    const { request } = raise(db, {
      policy: { ...POLICY, approvalExpiresAt: new Date('2026-11-01T00:00:00Z') },
    });
    const result = dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
    expect(result.reasons.map(r => r.code)).toContain('r01_approval_expired');
  });

  it('counts allowed dials against the R10 ceiling', () => {
    const tenantId = tenant(db);
    const { request: r1 } = raise(db, { tenantId, now: new Date('2026-11-26T06:00:00Z') });
    dispatchDialRequest(db, { aggregate_id: r1.id }, { now: new Date('2026-11-26T06:00:00Z') });
    const { request: r2 } = raise(db, { tenantId, now: new Date('2026-11-26T06:30:00Z') });
    dispatchDialRequest(db, { aggregate_id: r2.id }, { now: new Date('2026-11-26T06:30:00Z') });
    const { request: r3 } = raise(db, { tenantId });
    const result = dispatchDialRequest(db, { aggregate_id: r3.id }, { now: NOW });
    expect(result.reasons.map(r => r.code)).toContain('r10_retry_day');
  });

  it('readAttempts ignores denied rows and other tenants', () => {
    const tenantId = tenant(db);
    const { request } = raise(db, { tenantId });
    dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOW });
    const denied = raise(db, { tenantId, contact: { ...CONTACT, dncrStatus: 'listed' } });
    dispatchDialRequest(db, { aggregate_id: denied.request.id }, { now: NOW });
    const other = seed(db);
    const otherReq = requestDial(db, {
      ...other,
      campaign: CAMPAIGN,
      contact: { ...CONTACT, phone: '+971500000001' },
      policy: POLICY,
    });
    dispatchDialRequest(db, { aggregate_id: otherReq.request.id }, { now: NOW });

    const attempts = readAttempts(db, {
      tenantId: denied.tenantId,
      phone: CONTACT.phone,
      now: NOW,
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('no_answer');
    expect(attempts[0].at.toISOString()).toBe(NOW.toISOString());
  });

  it('runs inside dispatcher.dispatchOnce and acks allow and deny alike', async () => {
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    const tenantId = tenant(db);
    const allowed = raise(db, { tenantId });
    const denied = raise(db, { tenantId, contact: { ...CONTACT, dncrStatus: 'listed' } });
    const dispatcher = createDispatcher(db, { now: () => NOW });

    const first = await dispatcher.dispatchOnce();
    expect(first.failed).toBe(0);
    expect(first.acked).toBe(2);
    expect(
      db.prepare('SELECT status FROM dial_requests WHERE id = ?').get(allowed.request.id).status,
    ).toBe('allowed');
    expect(
      db.prepare('SELECT status FROM dial_requests WHERE id = ?').get(denied.request.id).status,
    ).toBe('denied');
    // the call.dial row the gate produced is claimed on the next pass, not lost
    const second = await dispatcher.dispatchOnce();
    expect(second.failed).toBe(0);
    expect(dialRows(db)[0].status).not.toBe('pending');
  });
});

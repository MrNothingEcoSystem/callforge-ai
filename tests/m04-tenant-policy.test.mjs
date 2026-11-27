import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  validatePolicyOptions,
  readTenantPolicy,
  writeTenantPolicy,
} from '../policies/tenantPolicy.mjs';
import { evaluateDial, POLICY_DEFAULTS } from '../policies/dialEligibility.mjs';
import { requestDialResolved, dispatchDialRequest } from '../workflow/dialGate.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m04p-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');
// 08:00 Asia/Dubai — outside the statutory 09:00 window, inside a 07:00 one.
const EARLY = new Date('2026-11-26T04:00:00Z');
const NOON = new Date('2026-11-26T08:00:00Z');

const POLICY = {
  licensed: true,
  approvalRef: 'TDRA-REF-1',
  approvalExpiresAt: new Date('2027-01-01T00:00:00Z'),
  cliInventory: ['+971500000001'],
};
const CAMPAIGN = {
  kind: 'marketing',
  cli: '+971500000001',
  purpose: 'renewal',
  phone: '+971500000009',
};
const CLEAN = { dncrStatus: 'clean', dncrCheckedAt: NOON, consent: { purpose: 'renewal' } };

const VALID = {
  callingWindow: { startHour: 7, endHour: 18 },
  retryLimits: { day: 2, week: 3 },
  dncrMaxAgeHours: 24,
};

const codes = verdict => verdict.reasons.map(r => r.code);
let seq = 0;

describe('tenant policy options (review #197 F4)', () => {
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
      'DELETE FROM outbox; DELETE FROM dial_requests; DELETE FROM call_intents; DELETE FROM tenant_policies; DELETE FROM consents; DELETE FROM tenants;',
    );
  });

  const tenant = () => {
    const id = generateId();
    db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(id, 'T');
    return id;
  };

  it('rejects an inverted window, a day ceiling above the week, and out-of-range ages', () => {
    const inverted = validatePolicyOptions({
      ...VALID,
      callingWindow: { startHour: 18, endHour: 9 },
    });
    expect(inverted.options).toBeNull();
    expect(inverted.violations.join(' ')).toContain('empty or inverted');

    const lopsided = validatePolicyOptions({ ...VALID, retryLimits: { day: 5, week: 3 } });
    expect(lopsided.violations.join(' ')).toContain('exceeds week');

    const stale = validatePolicyOptions({ ...VALID, dncrMaxAgeHours: 200 });
    expect(stale.violations.join(' ')).toContain('dncrMaxAgeHours');
  });

  it('defaults when no row exists, and fails closed on a corrupted row', () => {
    const id = tenant();
    expect(readTenantPolicy(db, id)).toMatchObject({ source: 'default', violations: [] });
    expect(readTenantPolicy(db, id).options).toEqual(POLICY_DEFAULTS);

    // 18–9 passes the CHECKs but is an inverted window.
    db.prepare(
      'INSERT INTO tenant_policies (tenant_id, window_start_hour, window_end_hour) VALUES (?, 18, 9)',
    ).run(id);
    const broken = readTenantPolicy(db, id);
    expect(broken.options).toBeNull();
    expect(broken.violations.length).toBeGreaterThan(0);
  });

  it('writeTenantPolicy validates and upserts', () => {
    const id = tenant();
    writeTenantPolicy(db, id, { ...VALID, callingWindow: { startHour: 8, endHour: 19 } });
    writeTenantPolicy(db, id, VALID);
    const read = readTenantPolicy(db, id);
    expect(read.options.callingWindow).toEqual({ startHour: 7, endHour: 18 });
    expect(() => writeTenantPolicy(db, id, { ...VALID, dncrMaxAgeHours: 0 })).toThrow(RangeError);
  });

  it('evaluator uses the tenant window instead of the statutory one', () => {
    const base = { now: EARLY, campaign: CAMPAIGN, contact: CLEAN, policy: POLICY };
    expect(codes(evaluateDial(base))).toContain('r08_outside_window');
    expect(codes(evaluateDial({ ...base, options: VALID }))).not.toContain('r08_outside_window');
  });

  it('evaluator applies tenant DNCR freshness and retry ceilings', () => {
    const stale = { ...CLEAN, dncrCheckedAt: new Date('2026-11-26T05:00:00Z') };
    expect(
      codes(evaluateDial({ now: NOON, campaign: CAMPAIGN, contact: stale, policy: POLICY })),
    ).not.toContain('r06_dncr_stale');
    expect(
      codes(
        evaluateDial({
          now: NOON,
          campaign: CAMPAIGN,
          contact: stale,
          policy: POLICY,
          options: { ...VALID, dncrMaxAgeHours: 2 },
        }),
      ),
    ).toContain('r06_dncr_stale');

    const attempts = [{ at: new Date('2026-11-26T06:00:00Z'), outcome: 'no_answer' }];
    const onePerDay = { ...VALID, retryLimits: { day: 1, week: 3 } };
    const verdict = evaluateDial({
      now: NOON,
      campaign: CAMPAIGN,
      contact: CLEAN,
      policy: POLICY,
      attempts,
      options: onePerDay,
    });
    expect(codes(verdict)).toContain('r10_retry_day');
  });

  it('denies on unusable options rather than widening the gate', () => {
    const verdict = evaluateDial({
      now: NOON,
      campaign: CAMPAIGN,
      contact: CLEAN,
      policy: POLICY,
      options: { ...VALID, callingWindow: { startHour: 20, endHour: 4 } },
    });
    expect(verdict.allowed).toBe(false);
    expect(codes(verdict)).toEqual(['invalid_policy']);
  });

  it('denies when an explicit null options snapshot is handed in (TECH-013 F1)', () => {
    const contact = { ...CLEAN, phone: '+971501234567' };
    const base = { now: NOON, campaign: CAMPAIGN, contact, policy: POLICY };
    // Absent options = no tenant record -> statutory defaults (allowed).
    expect(evaluateDial(base).allowed).toBe(true);
    // Explicit null = the stored row failed validation -> deny, never widen.
    const verdict = evaluateDial({ ...base, options: null });
    expect(verdict.allowed).toBe(false);
    expect(codes(verdict)).toEqual(['invalid_policy']);
  });

  it('denies end-to-end when the stored row is corrupted after the request', async () => {
    const id = tenant();
    writeTenantPolicy(db, id, VALID);
    const intentId = generateId();
    db.prepare(
      'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
    ).run(intentId, id, `intent-${intentId}`, 'outbound', 'approved');
    db.prepare(
      'INSERT INTO consents (id, tenant_id, phone, purpose, granted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      generateId(),
      id,
      CAMPAIGN.phone,
      'renewal',
      '2026-11-01T00:00:00Z',
      '2026-11-01T00:00:00Z',
    );
    seq += 1;
    const { request } = await requestDialResolved(db, {
      tenantId: id,
      callIntentId: intentId,
      idempotencyKey: `dial-broken-${seq}`,
      campaign: CAMPAIGN,
      policy: POLICY,
      dncr: {
        check: async () => ({
          status: 'clean',
          checkedAt: new Date('2026-11-26T05:00:00Z'),
          reference: 'x',
        }),
      },
      now: NOON,
    });
    // Corrupt the row the way a hand edit or a stale writer would: 18–9 passes
    // the column CHECKs but is an inverted window, so it is unusable.
    db.prepare(
      'UPDATE tenant_policies SET window_start_hour = 18, window_end_hour = 9 WHERE tenant_id = ?',
    ).run(id);
    // Re-snapshot with the corrupted row, then dispatch: must deny.
    const fresh = await requestDialResolved(db, {
      tenantId: id,
      callIntentId: intentId,
      idempotencyKey: `dial-broken2-${seq}`,
      campaign: CAMPAIGN,
      policy: POLICY,
      dncr: {
        check: async () => ({
          status: 'clean',
          checkedAt: new Date('2026-11-26T05:00:00Z'),
          reference: 'x',
        }),
      },
      now: NOON,
    });
    const outcome = dispatchDialRequest(db, { aggregate_id: fresh.request.id }, { now: NOON });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reasons.map(r => r.code)).toEqual(['invalid_policy']);
    // The earlier snapshot was taken while the row was still valid and allows.
    const ok = dispatchDialRequest(db, { aggregate_id: request.id }, { now: NOON });
    expect(ok.allowed).toBe(true);
  });

  it('snapshots the tenant policy with the resolved request', async () => {
    const id = tenant();
    writeTenantPolicy(db, id, VALID);
    const intentId = generateId();
    db.prepare(
      'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
    ).run(intentId, id, `intent-${intentId}`, 'outbound', 'approved');
    db.prepare(
      'INSERT INTO consents (id, tenant_id, phone, purpose, granted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      generateId(),
      id,
      CAMPAIGN.phone,
      'renewal',
      '2026-11-01T00:00:00Z',
      '2026-11-01T00:00:00Z',
    );

    seq += 1;
    const { request } = await requestDialResolved(db, {
      tenantId: id,
      callIntentId: intentId,
      idempotencyKey: `dial-p-${seq}`,
      campaign: CAMPAIGN,
      policy: POLICY,
      dncr: {
        check: async () => ({
          status: 'clean',
          checkedAt: new Date('2026-11-26T03:00:00Z'),
          reference: 'x',
        }),
      },
      now: EARLY,
    });
    expect(JSON.parse(request.policy_json).options.callingWindow).toEqual(VALID.callingWindow);

    const outcome = dispatchDialRequest(db, { aggregate_id: request.id }, { now: EARLY });
    expect(outcome.reasons ?? []).toEqual([]);
  });
});

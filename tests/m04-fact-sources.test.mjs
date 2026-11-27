import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createCachedDncrSource,
  createFailingDncrProvider,
  createStaticDncrProvider,
} from '../sources/dncr.mjs';
import {
  lookupConsent,
  readOptOuts,
  recordConsent,
  recordOptOut,
  withdrawConsent,
} from '../sources/consent.mjs';
import { resolveContactFacts } from '../sources/facts.mjs';
import { requestDialResolved } from '../workflow/dialGate.mjs';
import { createDispatcher } from '../workflow/dispatcher.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-t12-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');
// 11:00 Asia/Dubai, Thursday — inside the window.
const NOW = new Date('2026-11-26T07:00:00Z');
const PHONE = '+971501234567';
const POLICY = {
  licensed: true,
  approvalRef: 'TDRA-REF-1',
  approvalExpiresAt: new Date('2027-01-01T00:00:00Z'),
  cliInventory: ['+97145556666'],
};
const CAMPAIGN = { kind: 'marketing', cli: '+97145556666', purpose: 'renewal', phone: PHONE };

let seq = 0;
let db;
let clock;

function tenant() {
  const id = generateId();
  db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(id, 'T', '{}');
  return id;
}

function seed(tenantId) {
  const intentId = generateId();
  db.prepare(
    'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
  ).run(intentId, tenantId, `intent-${intentId}`, 'outbound', 'approved');
  seq += 1;
  return { tenantId, callIntentId: intentId, idempotencyKey: `t12-${seq}` };
}

function countingProvider(entries) {
  const calls = [];
  const inner = createStaticDncrProvider(entries);
  return { calls, check: q => (calls.push(q.phone), inner.check(q)) };
}

const dial = () => db.prepare("SELECT * FROM outbox WHERE type = 'call.dial'").all();

describe('M04 fact sources (TECH-012)', () => {
  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    setTestDatabasePath(DB_PATH);
    const { initDatabase } = await import('../store.mjs');
    await initDatabase();
    db = getDatabase();
    clock = { now: NOW };
  });

  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    await closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.exec(
      `DELETE FROM outbox; DELETE FROM dial_requests; DELETE FROM call_intents;
       DELETE FROM consents; DELETE FROM opt_outs; DELETE FROM dncr_checks; DELETE FROM tenants;`,
    );
    clock.now = NOW;
  });

  it('serves a fresh cached answer without calling the provider again', async () => {
    const t = tenant();
    const provider = countingProvider({ [PHONE]: 'clean' });
    const source = createCachedDncrSource(db, { provider, now: () => clock.now });
    const first = await source.check({ tenantId: t, phone: PHONE });
    const second = await source.check({ tenantId: t, phone: PHONE });
    expect(first.status).toBe('clean');
    expect(second.cached).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it('re-queries once the cache is past 24h', async () => {
    const t = tenant();
    const provider = countingProvider({ [PHONE]: 'clean' });
    const source = createCachedDncrSource(db, { provider, now: () => clock.now });
    await source.check({ tenantId: t, phone: PHONE });
    clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
    const again = await source.check({ tenantId: t, phone: PHONE });
    expect(again.cached).toBe(false);
    expect(provider.calls).toHaveLength(2);
  });

  it('clamps a long requested TTL to the 24h freshness policy', async () => {
    const t = tenant();
    const provider = countingProvider({ [PHONE]: 'clean' });
    const source = createCachedDncrSource(db, { provider, ttlHours: 48, now: () => clock.now });
    expect(source.ttlHours).toBe(24);
    await source.check({ tenantId: t, phone: PHONE });
    clock.now = new Date(NOW.getTime() + 26 * 3_600_000);
    const again = await source.check({ tenantId: t, phone: PHONE });
    expect(again.cached).toBe(false);
    expect(provider.calls).toHaveLength(2);
  });

  it('does not trust a future-dated cache row', async () => {
    const t = tenant();
    const provider = countingProvider({ [PHONE]: 'clean' });
    db.prepare(
      "INSERT INTO dncr_checks VALUES (?, ?, 'clean', datetime('now', '+2 hours'), NULL)",
    ).run(t, PHONE);
    const source = createCachedDncrSource(db, { provider, now: () => clock.now });
    const answer = await source.check({ tenantId: t, phone: PHONE });
    expect(answer.cached).toBe(false);
    expect(provider.calls).toHaveLength(1);
  });

  it('normalises a provider outage to unknown with no fresh timestamp', async () => {
    const t = tenant();
    const source = createCachedDncrSource(db, {
      provider: createFailingDncrProvider('portal down'),
      now: () => clock.now,
    });
    const answer = await source.check({ tenantId: t, phone: PHONE });
    expect(answer.status).toBe('unknown');
    expect(answer.checkedAt).toBeNull();
    expect(answer.reference).toContain('portal down');
  });

  it('normalises an unrecognised provider answer to unknown', async () => {
    const t = tenant();
    const source = createCachedDncrSource(db, {
      provider: { check: () => ({ status: 'probably-fine' }) },
      now: () => clock.now,
    });
    const answer = await source.check({ tenantId: t, phone: PHONE });
    expect(answer.status).toBe('unknown');
    expect(answer.reference).toBe('provider_unrecognised_answer');
  });

  it('keys the cache per tenant', async () => {
    const a = tenant();
    const b = tenant();
    const source = createCachedDncrSource(db, {
      provider: createStaticDncrProvider({ [PHONE]: 'clean' }),
      now: () => clock.now,
    });
    await source.check({ tenantId: a, phone: PHONE });
    const other = await source.check({ tenantId: b, phone: PHONE });
    expect(other.cached).toBe(false);
  });

  it('requires evidence for a consent grant and clears withdrawal on re-grant', () => {
    const t = tenant();
    expect(() => recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal' })).toThrow(
      TypeError,
    );
    recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal', evidenceRef: 'form:42' });
    expect(withdrawConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal' })).toBe(true);
    expect(lookupConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal' }).withdrawn).toBe(
      true,
    );
    expect(withdrawConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal' })).toBe(false);
    recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal', evidenceRef: 'form:43' });
    expect(lookupConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal' }).withdrawn).toBe(
      false,
    );
  });

  it('reports the other purpose when consent exists only for a different one', async () => {
    const t = tenant();
    recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'winback', evidenceRef: 'form:9' });
    const facts = await resolveContactFacts(db, { tenantId: t, phone: PHONE, purpose: 'renewal' });
    expect(facts.consent.purpose).toBe('winback');
  });

  it('treats a global opt-out as an offer opt-out', () => {
    const t = tenant();
    recordOptOut(db, { tenantId: t, phone: PHONE, scope: 'global' });
    expect(readOptOuts(db, { tenantId: t, phone: PHONE })).toEqual({
      optedOut: true,
      optOutGlobal: true,
    });
  });

  it('leaves DNCR unknown when no source is configured', async () => {
    const t = tenant();
    const facts = await resolveContactFacts(db, { tenantId: t, phone: PHONE });
    expect(facts.dncrStatus).toBe('unknown');
    expect(facts.dncrReference).toBe('no_dncr_source');
  });

  it('snapshots resolved facts: the provider answer beats the caller', async () => {
    const t = tenant();
    const provider = createStaticDncrProvider({ [PHONE]: 'listed' });
    recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal', evidenceRef: 'form:1' });
    const { request } = await requestDialResolved(db, {
      ...seed(t),
      campaign: CAMPAIGN,
      policy: POLICY,
      dncr: createCachedDncrSource(db, { provider, now: () => clock.now }),
      now: NOW,
    });
    const snapshot = JSON.parse(
      db.prepare('SELECT contact_json FROM dial_requests WHERE id = ?').get(request.id)
        .contact_json,
    );
    expect(snapshot.dncrStatus).toBe('listed');
    expect(snapshot.resolvedBy).toBe('sources');
    expect(snapshot.consentEvidenceRef).toBe('form:1');
    const dispatcher = createDispatcher(db, { now: () => NOW });
    await dispatcher.dispatchOnce();
    expect(db.prepare('SELECT status FROM dial_requests WHERE id = ?').get(request.id).status).toBe(
      'denied',
    );
    expect(dial()).toHaveLength(0);
  });

  it('allows exactly one dial end-to-end on a clean, consented, opted-in number', async () => {
    const t = tenant();
    recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal', evidenceRef: 'form:1' });
    const { request } = await requestDialResolved(db, {
      ...seed(t),
      campaign: CAMPAIGN,
      policy: POLICY,
      dncr: createCachedDncrSource(db, {
        provider: createStaticDncrProvider({ [PHONE]: 'clean' }),
        now: () => clock.now,
      }),
      now: NOW,
    });
    const dispatcher = createDispatcher(db, { now: () => NOW });
    const pass = await dispatcher.dispatchOnce();
    expect(pass.failed).toBe(0);
    expect(db.prepare('SELECT status FROM dial_requests WHERE id = ?').get(request.id).status).toBe(
      'allowed',
    );
    expect(dial()).toHaveLength(1);
  });

  it('denies when the provider is down rather than guessing clean', async () => {
    const t = tenant();
    recordConsent(db, { tenantId: t, phone: PHONE, purpose: 'renewal', evidenceRef: 'form:1' });
    const { request } = await requestDialResolved(db, {
      ...seed(t),
      campaign: CAMPAIGN,
      policy: POLICY,
      dncr: createCachedDncrSource(db, {
        provider: createFailingDncrProvider(),
        now: () => clock.now,
      }),
      now: NOW,
    });
    const dispatcher = createDispatcher(db, { now: () => NOW });
    await dispatcher.dispatchOnce();
    const row = db
      .prepare('SELECT status, reasons_json FROM dial_requests WHERE id = ?')
      .get(request.id);
    expect(row.status).toBe('denied');
    expect(JSON.parse(row.reasons_json).map(r => r.code)).toContain('r06_dncr_unknown');
  });

  it('validates the intent before querying the provider', async () => {
    const t = tenant();
    const provider = countingProvider({});
    const ids = seed(t);
    await expect(
      requestDialResolved(db, {
        ...ids,
        callIntentId: 'nope',
        campaign: CAMPAIGN,
        policy: POLICY,
        dncr: createCachedDncrSource(db, { provider, now: () => clock.now }),
        now: NOW,
      }),
    ).rejects.toThrow(ReferenceError);
    expect(provider.calls).toHaveLength(0);
  });

  it('is idempotent on the key and does not re-resolve', async () => {
    const t = tenant();
    const provider = countingProvider({ [PHONE]: 'clean' });
    const ids = seed(t);
    const dncr = createCachedDncrSource(db, { provider, now: () => clock.now });
    const opts = { ...ids, campaign: CAMPAIGN, policy: POLICY, dncr, now: NOW };
    const first = await requestDialResolved(db, opts);
    const second = await requestDialResolved(db, opts);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(provider.calls).toHaveLength(1);
  });
});

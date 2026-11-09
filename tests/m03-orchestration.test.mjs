import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { enqueue, claimBatch } from '../workflow/outbox.mjs';
import { receiveWebhook } from '../workflow/webhookInbox.mjs';
import { consumeQuota, releaseQuota, planRetention, executeRetention } from '../workflow/quota.mjs';
import { createDispatcher } from '../workflow/dispatcher.mjs';
import { runRecovery } from '../workflow/recovery.mjs';
import { runReconciler } from '../workflow/reconciler.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m032-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');

function seedTenantQuota(db, limit, used = 0) {
  const tenantId = generateId();
  db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantId, 'T', '{}');
  db.prepare(
    'INSERT INTO tenant_quotas (tenant_id, resource, limit_value, used) VALUES (?, ?, ?, ?)',
  ).run(tenantId, 'calls', limit, used);
  return tenantId;
}

describe('M03-2 orchestration', () => {
  beforeAll(async () => {
    setTestDatabasePath(DB_PATH);
    const { initDatabase } = await import('../store.mjs');
    await initDatabase();
  });

  afterAll(async () => {
    await closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('dispatcher honors the OUTBOX_DISPATCHER_ENABLED gate', async () => {
    const db = getDatabase();
    const dispatcher = createDispatcher(db);
    process.env.OUTBOX_DISPATCHER_ENABLED = '0';
    enqueue(db, { tenantId: null, aggregateType: 't', aggregateId: 'x', type: 'nope' });
    const gated = await dispatcher.dispatchOnce();
    expect(gated.claimed).toBe(0);
    expect(dispatcher.start()).toMatchObject({ started: false });
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
  });

  it('dispatcher end-to-end ack/fail with handler registry', async () => {
    const db = getDatabase();
    const ok = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'ok',
      type: 'test.ok',
      payload: {},
    });
    const bad = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'bad',
      type: 'test.boom',
      payload: {},
    });
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    const dispatcher = createDispatcher(db, {
      handlers: {
        'test.ok': async () => ({ acked: true }),
        'test.boom': async () => {
          throw new Error('boom');
        },
      },
    });
    const result = await dispatcher.dispatchOnce();
    expect(result.acked).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const okRow = db.prepare('SELECT status FROM outbox WHERE id = ?').get(ok.row.id);
    expect(okRow.status).toBe('acked');
    const badRow = db.prepare('SELECT status FROM outbox WHERE id = ?').get(bad.row.id);
    expect(badRow.status).toBe('pending');
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    dispatcher.stop();
  });

  it('dispatcher respects backoff (failed rows not immediately reclaimable)', async () => {
    const db = getDatabase();
    const { row } = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'bf',
      type: 'test.boom',
      payload: {},
    });
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    const dispatcher = createDispatcher(db, {
      handlers: {
        'test.boom': async () => {
          throw new Error('x');
        },
      },
    });
    await dispatcher.dispatchOnce();
    const again = claimBatch(db, { workerId: 'w2' }).some(r => r.id === row.id);
    expect(again).toBe(false);
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    dispatcher.stop();
  });

  it('quota consume is atomic under parallel consume (never over limit)', () => {
    const db = getDatabase();
    const tenantId = seedTenantQuota(db, 5);
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(consumeQuota(db, tenantId, 'calls'));
    }
    expect(results.filter(r => r.consumed).length).toBe(5);
    const row = db.prepare('SELECT used FROM tenant_quotas WHERE tenant_id = ?').get(tenantId);
    expect(row.used).toBe(5);
    const rel = releaseQuota(db, tenantId, 'calls');
    expect(rel).toMatchObject({ released: true, used: 4 });
    expect(consumeQuota(db, tenantId, 'calls')).toMatchObject({ consumed: true, used: 5 });
  });

  it('consumeQuota fails closed when no quota row exists', () => {
    const db = getDatabase();
    const tenantId = generateId();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'T',
      '{}',
    );
    expect(consumeQuota(db, tenantId, 'calls').consumed).toBe(false);
  });

  it('retention never deletes without both env flags', () => {
    const db = getDatabase();
    const tenantId = seedTenantQuota(db, 100);
    db.prepare(
      'INSERT INTO retention_policies (tenant_id, resource, retain_days) VALUES (?, ?, ?)',
    ).run(tenantId, 'outbox', 0);
    // Seed deletable rows: acked outbox rows older than the retention window.
    db.prepare(
      'UPDATE outbox SET status = \'acked\', tenant_id = ?, acked_at = datetime(\'now\', \'-2 days\')',
    ).run(tenantId);
    const before = db.prepare('SELECT COUNT(*) n FROM outbox').get().n;
    delete process.env.RETENTION_ENABLED;
    delete process.env.RETENTION_DRY_RUN;
    const closed = executeRetention(db);
    expect(closed.executed).toBe(false);
    expect(db.prepare('SELECT COUNT(*) n FROM outbox').get().n).toBe(before);
    process.env.RETENTION_ENABLED = '1';
    const dry = executeRetention(db);
    expect(dry.executed).toBe(false);
    process.env.RETENTION_DRY_RUN = '0';
    const open = executeRetention(db);
    expect(open.executed).toBe(true);
    const after = db.prepare('SELECT COUNT(*) n FROM outbox').get().n;
    expect(after).toBeLessThan(before);
    // planRetention is report-only
    const plan = planRetention(db);
    expect(plan[0].dry_run).toBe(true);
    delete process.env.RETENTION_ENABLED;
    delete process.env.RETENTION_DRY_RUN;
  });

  it('recovery resets processing webhooks and reclaims expired leases', () => {
    const db = getDatabase();
    receiveWebhook(db, { provider: 'rec', rawBody: '{}' });
    db.prepare("UPDATE webhook_inbox SET status = 'processing' WHERE provider = 'rec'").run();
    const { row } = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'rec',
      type: 'test.ok',
    });
    db.prepare(
      "UPDATE outbox SET status = 'claimed', claimed_by = 'dead-worker', lease_expires_at = datetime('now', '-1 minute') WHERE id = ?",
    ).run(row.id);
    const result = runRecovery(db);
    expect(result.reset_webhooks).toBeGreaterThanOrEqual(1);
    expect(result.reclaimed_leases).toBeGreaterThanOrEqual(1);
    const wh = db.prepare("SELECT status FROM webhook_inbox WHERE provider = 'rec'").get();
    expect(wh.status).toBe('received');
    const ob = db.prepare('SELECT status FROM outbox WHERE id = ?').get(row.id);
    expect(ob.status).toBe('pending');
  });

  it('reconciler reports counts without forced transitions', () => {
    const db = getDatabase();
    const counts = runReconciler(db);
    expect(counts).toMatchObject({
      orphaned_webhooks: expect.any(Number),
      stuck_webhooks: expect.any(Number),
      stuck_dispatched_intents: expect.any(Number),
      dead_letter_outbox: expect.any(Number),
      pending_outbox: expect.any(Number),
      quota_drift_tenants: expect.any(Number),
    });
  });
});

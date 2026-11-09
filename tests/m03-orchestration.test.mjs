import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { enqueue, claimBatch, fail } from '../workflow/outbox.mjs';
import { receiveWebhook } from '../workflow/webhookInbox.mjs';
import {
  consumeQuota,
  releaseQuota,
  checkQuota,
  planRetention,
  executeRetention,
} from '../workflow/quota.mjs';
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
      "UPDATE outbox SET status = 'acked', tenant_id = ?, acked_at = datetime('now', '-2 days')",
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

  // ---- Independent review regression tests (M03-2 review, 2026-11-09) ----

  it('two concurrent workers claim disjoint rows (no double-delivery)', () => {
    const db = getDatabase();
    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        enqueue(db, { tenantId: null, aggregateType: 't', aggregateId: `cc${i}`, type: 'test.ok' })
          .row.id,
      );
    }
    db.prepare(
      `UPDATE outbox SET available_at = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`,
    ).run(...ids);
    const w1 = claimBatch(db, { workerId: 'rev-w1', limit: 10 });
    const w2 = claimBatch(db, { workerId: 'rev-w2', limit: 10 });
    const overlap = w1.some(r => w2.some(s => s.id === r.id));
    expect(overlap).toBe(false);
  });

  it('retry exhaustion dead-letters after MAX_ATTEMPTS (5) claims', () => {
    const db = getDatabase();
    const { row } = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'exh',
      type: 'test.boom',
    });
    for (let i = 0; i < 10; i++) {
      const claimed = claimBatch(db, { workerId: 'rev-w' });
      const me = claimed.find(r => r.id === row.id);
      if (!me) {
        break;
      }
      fail(db, row.id, 'rev-w', 'boom');
      db.prepare("UPDATE outbox SET available_at = datetime('now','-1 hour') WHERE id = ?").run(
        row.id,
      );
    }
    const dead = db.prepare('SELECT status, attempts FROM outbox WHERE id = ?').get(row.id);
    expect(dead.status).toBe('dead');
    expect(dead.attempts).toBe(5);
  });

  it('webhook replay: identical body dedups; same key + different body preserves first', () => {
    const db = getDatabase();
    const a1 = receiveWebhook(db, { provider: 'rev-replay', rawBody: '{"x":1}' });
    const a2 = receiveWebhook(db, { provider: 'rev-replay', rawBody: '{"x":1}' });
    expect(a2.stored).toBe(false);
    expect(a2.row.id).toBe(a1.row.id);
    receiveWebhook(db, { provider: 'rev-replay2', dedupKey: 'k1', rawBody: '{"v":1}' });
    const b2 = receiveWebhook(db, { provider: 'rev-replay2', dedupKey: 'k1', rawBody: '{"v":2}' });
    expect(b2.stored).toBe(false);
    expect(b2.row.raw_body).toBe('{"v":1}');
  });

  it('webhook lifecycle: received -> processing -> processed (F1 remediated)', async () => {
    const db = getDatabase();
    receiveWebhook(db, { provider: 'rev-f1', rawBody: '{"f1":true}' });
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    await createDispatcher(db).dispatchOnce();
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    const wh = db
      .prepare("SELECT status, processed_at FROM webhook_inbox WHERE provider = 'rev-f1'")
      .get();
    expect(wh.status).toBe('processed');
    expect(wh.processed_at).toBeTruthy();
    const counts = runReconciler(db);
    expect(counts.stuck_webhooks).toBe(0);
  });

  it('crash between processing and ack: lease reclaim redelivers to processed (F1 adversarial)', async () => {
    const db = getDatabase();
    const { row: wh } = receiveWebhook(db, { provider: 'rev-crash', rawBody: '{"crash":1}' });
    // Simulate crash: webhook reached 'processing', outbox row was claimed
    // by a dead worker with an expired lease and was never acked.
    db.prepare("UPDATE webhook_inbox SET status = 'processing' WHERE id = ?").run(wh.id);
    const ob = db.prepare('SELECT id FROM outbox WHERE aggregate_id = ?').get(wh.id);
    db.prepare(
      "UPDATE outbox SET status='claimed', claimed_by='dead', attempts=1, lease_expires_at=datetime('now','-1 minute') WHERE id = ?",
    ).run(ob.id);
    const rec = runRecovery(db);
    expect(rec.reclaimed_leases).toBeGreaterThanOrEqual(1);
    expect(rec.reset_webhooks).toBeGreaterThanOrEqual(1);
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    await createDispatcher(db).dispatchOnce();
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    const done = db.prepare('SELECT status FROM webhook_inbox WHERE id = ?').get(wh.id);
    expect(done.status).toBe('processed');
    const obDone = db.prepare('SELECT status FROM outbox WHERE id = ?').get(ob.id);
    expect(obDone.status).toBe('acked');
  });

  it('redelivery of an already-processed webhook is a no-op (idempotent handler)', async () => {
    const db = getDatabase();
    receiveWebhook(db, { provider: 'rev-idem', rawBody: '{"idem":1}' });
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    const d = createDispatcher(db);
    await d.dispatchOnce();
    // Re-enqueue a duplicate delivery of the same webhook.
    enqueue(db, {
      tenantId: null,
      aggregateType: 'webhook',
      aggregateId: db.prepare("SELECT id FROM webhook_inbox WHERE provider='rev-idem'").get().id,
      type: 'webhook.received',
      dedupKey: 'rev-idem-2',
    });
    const before = db
      .prepare('SELECT processed_at FROM webhook_inbox WHERE provider = ?')
      .get('rev-idem').processed_at;
    await d.dispatchOnce();
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    const after = db
      .prepare('SELECT status, processed_at FROM webhook_inbox WHERE provider = ?')
      .get('rev-idem');
    expect(after.status).toBe('processed');
    expect(after.processed_at).toBe(before);
  });

  it('recovery reclaims NULL-lease claimed rows (F2 remediated)', () => {
    const db = getDatabase();
    const { row } = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'nl',
      type: 'test.ok',
    });
    db.prepare(
      "UPDATE outbox SET status = 'claimed', claimed_by = 'dead', lease_expires_at = NULL WHERE id = ?",
    ).run(row.id);
    const result = runRecovery(db);
    expect(result.reclaimed_leases).toBeGreaterThanOrEqual(1);
    const ob = db.prepare('SELECT status FROM outbox WHERE id = ?').get(row.id);
    expect(ob.status).toBe('pending');
  });

  it('stale leases are reclaimed; fresh leases are not', () => {
    const db = getDatabase();
    const stale = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'stale',
      type: 'test.ok',
    }).row;
    const fresh = enqueue(db, {
      tenantId: null,
      aggregateType: 't',
      aggregateId: 'fresh',
      type: 'test.ok',
    }).row;
    db.prepare(
      "UPDATE outbox SET status='claimed', claimed_by='w', lease_expires_at=datetime('now','-1 minute') WHERE id = ?",
    ).run(stale.id);
    db.prepare(
      "UPDATE outbox SET status='claimed', claimed_by='w', lease_expires_at=datetime('now','+10 minutes') WHERE id = ?",
    ).run(fresh.id);
    const result = runRecovery(db);
    expect(result.reclaimed_leases).toBe(1);
    expect(db.prepare('SELECT status FROM outbox WHERE id = ?').get(stale.id).status).toBe(
      'pending',
    );
    expect(db.prepare('SELECT status FROM outbox WHERE id = ?').get(fresh.id).status).toBe(
      'claimed',
    );
  });

  it('audit-chain retention is excluded: chain verifies before and after retention (F3 remediated)', async () => {
    const db = getDatabase();
    const { transition } = await import('../workflow/stateMachine.mjs');
    const { createAuditLogger } = await import('../audit.mjs');
    const tid = seedTenantQuota(db, 100);
    const intentId = generateId();
    db.prepare(
      'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
    ).run(intentId, tid, 'k-audit', 'outbound', 'pending');
    transition(db, { intentId, to: 'approved', actor: 'f3-test' });
    const logger = createAuditLogger();
    await logger.initialize();
    const before = await logger.verifyChain();
    expect(before.valid).toBe(true);
    const count = db.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
    expect(count).toBeGreaterThan(0);
    db.prepare(
      'INSERT INTO retention_policies (tenant_id, resource, retain_days) VALUES (?,?,0)',
    ).run(tid, 'audit_events');
    process.env.RETENTION_ENABLED = '1';
    process.env.RETENTION_DRY_RUN = '0';
    const res = executeRetention(db);
    delete process.env.RETENTION_ENABLED;
    delete process.env.RETENTION_DRY_RUN;
    const excluded = res.deleted.find(d => d.resource === 'audit_events');
    expect(excluded).toMatchObject({ deleted: 0, excluded: 'audit_chain_protected' });
    expect(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n).toBe(count);
    const after = await logger.verifyChain();
    expect(after.valid).toBe(true);
  });

  it('dispatcher start is idempotent and re-checks the env gate (F6)', () => {
    const db = getDatabase();
    const d = createDispatcher(db, { pollMs: 60000 });
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    expect(d.start()).toMatchObject({ started: true });
    expect(d.start()).toMatchObject({ started: false, reason: 'already_running' });
    expect(d.running).toBe(true);
    d.stop();
    expect(d.running).toBe(false);
    // Restart after stop works; env toggle off stops it too.
    expect(d.start()).toMatchObject({ started: true });
    d.stop();
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    expect(d.start()).toMatchObject({ started: false });
  });

  it('dispatcher late-enables after server-style initialize (env set after create)', async () => {
    const db = getDatabase();
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    const d = createDispatcher(db);
    expect(d.start()).toMatchObject({ started: false });
    process.env.OUTBOX_DISPATCHER_ENABLED = '1';
    enqueue(db, { tenantId: null, aggregateType: 't', aggregateId: 'late', type: 'test.ok' });
    const r = await d.dispatchOnce();
    delete process.env.OUTBOX_DISPATCHER_ENABLED;
    expect(r.claimed).toBeGreaterThanOrEqual(1);
  });

  it('quota limit_value=0 is unlimited (consistent with checkQuota); consume caps at limit>0', () => {
    const db = getDatabase();
    const tenantId = seedTenantQuota(db, 0);
    expect(checkQuota(db, tenantId, 'calls').allowed).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(consumeQuota(db, tenantId, 'calls').consumed).toBe(true);
    }
  });
});

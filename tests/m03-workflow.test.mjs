import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runMigrations } from '../db/migrate.mjs';
import { transition, canTransition, InvalidTransitionError } from '../workflow/stateMachine.mjs';
import { enqueue, claimBatch, ack, fail } from '../workflow/outbox.mjs';
import { receiveWebhook, reconcileProviderEvent } from '../workflow/webhookInbox.mjs';
import { checkQuota, applyRetention } from '../workflow/quota.mjs';
import { backupDatabase, restoreDatabase } from '../scripts/backup.mjs';
import { closeStore, generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m03-'));
const DB_PATH = join(TEST_DIR, 'callforge.db');

function seedTenantAndIntent(db, status = 'pending') {
  const tenantId = generateId();
  db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantId, 'T', '{}');
  const intentId = generateId();
  db.prepare(
    'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
  ).run(intentId, tenantId, `key-${intentId}`, 'outbound', status);
  return { tenantId, intentId };
}

describe('M03 durable workflow', () => {
  beforeAll(async () => {
    setTestDatabasePath(DB_PATH);
    const { initDatabase } = await import('../store.mjs');
    await initDatabase();
  });

  afterAll(async () => {
    await closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('records migrations and re-run is a no-op', () => {
    const db = getDatabase();
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions.map(v => v.version)).toEqual(['0001', '0002', '0003']);
    const again = runMigrations(db);
    expect(again.applied).toEqual([]);
    expect(again.skipped).toEqual(['0001', '0002', '0003']);
  });

  it('enforces the state machine transitions', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'completed')).toBe(false);
    expect(canTransition('completed', 'failed')).toBe(false);
    const db = getDatabase();
    const { intentId } = seedTenantAndIntent(db);
    expect(() => transition(db, { intentId, to: 'completed' })).toThrow(InvalidTransitionError);
    const result = transition(db, { intentId, to: 'approved', actor: 'test' });
    expect(result).toMatchObject({ from: 'pending', to: 'approved' });
    const row = db.prepare('SELECT status FROM call_intents WHERE id = ?').get(intentId);
    expect(row.status).toBe('approved');
    // Atomic side effects: call_event + outbox + transition record exist
    expect(
      db.prepare('SELECT COUNT(*) n FROM call_events WHERE call_intent_id = ?').get(intentId).n,
    ).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM outbox WHERE aggregate_id = ?').get(intentId).n).toBe(
      1,
    );
    expect(
      db
        .prepare(
          'SELECT COUNT(*) n FROM call_state_transitions WHERE call_intent_id = ? AND result = ?',
        )
        .get(intentId, 'applied').n,
    ).toBe(1);
  });

  it('outbox claim/ack with lease reclaim and dedup', () => {
    const db = getDatabase();
    const { tenantId, intentId } = seedTenantAndIntent(db);
    const first = enqueue(db, {
      tenantId,
      aggregateType: 'call_intent',
      aggregateId: intentId,
      type: 'call_intent.created',
      dedupKey: 'dedup-1',
    });
    expect(first.inserted).toBe(true);
    const dupe = enqueue(db, {
      tenantId,
      aggregateType: 'call_intent',
      aggregateId: intentId,
      type: 'call_intent.created',
      dedupKey: 'dedup-1',
    });
    expect(dupe.inserted).toBe(false);
    const claimed = claimBatch(db, { workerId: 'w1', limit: 1, leaseSeconds: 0 });
    expect(claimed.length).toBeGreaterThan(0);
    // Force lease expiry, then a second worker reclaims (crash recovery)
    db.prepare(
      "UPDATE outbox SET lease_expires_at = datetime('now', '-1 second') WHERE id = ?",
    ).run(first.row.id);
    const reclaimed = claimBatch(db, { workerId: 'w2', limit: 10, leaseSeconds: 60 });
    expect(reclaimed.some(r => r.id === first.row.id)).toBe(true);
    expect(ack(db, first.row.id, 'w2')).toBe(true);
  });

  it('outbox fail backs off and eventually dead-letters', () => {
    const db = getDatabase();
    const { tenantId, intentId } = seedTenantAndIntent(db);
    const { row } = enqueue(db, {
      tenantId,
      aggregateType: 'call_intent',
      aggregateId: intentId,
      type: 'x',
      dedupKey: `fail-${intentId}`,
    });
    for (let i = 0; i < 6; i += 1) {
      claimBatch(db, { workerId: 'w', limit: 10 });
      fail(db, row.id, 'w', 'boom');
      // Backoff is honored (available_at in future); fast-forward for the test.
      db.prepare("UPDATE outbox SET available_at = datetime('now', '-1 second') WHERE id = ?").run(
        row.id,
      );
    }
    const final = db.prepare('SELECT status FROM outbox WHERE id = ?').get(row.id);
    expect(final.status).toBe('dead');
  });

  it('webhook inbox dedups and enqueues once', () => {
    const db = getDatabase();
    const first = receiveWebhook(db, {
      provider: 'sandbox',
      dedupKey: 'evt-1',
      rawBody: '{"a":1}',
    });
    expect(first.stored).toBe(true);
    const dupe = receiveWebhook(db, { provider: 'sandbox', dedupKey: 'evt-1', rawBody: '{"a":1}' });
    expect(dupe.stored).toBe(false);
    expect(
      db.prepare('SELECT COUNT(*) n FROM webhook_inbox WHERE provider = ?').get('sandbox').n,
    ).toBe(1);
  });

  it('reconciles provider events through the state machine', () => {
    const db = getDatabase();
    const { intentId } = seedTenantAndIntent(db, 'dispatched');
    const applied = reconcileProviderEvent(db, {
      provider: 'sandbox',
      providerEventId: 'pe-1',
      callIntentId: intentId,
      eventType: 'call.completed',
    });
    expect(applied.applied).toBe(true);
    const dupe = reconcileProviderEvent(db, {
      provider: 'sandbox',
      providerEventId: 'pe-1',
      callIntentId: intentId,
      eventType: 'call.completed',
    });
    expect(dupe.ignored_duplicate).toBe(true);
    const { intentId: pendingId } = seedTenantAndIntent(db, 'pending');
    const stale = reconcileProviderEvent(db, {
      provider: 'sandbox',
      providerEventId: 'pe-2',
      callIntentId: pendingId,
      eventType: 'call.completed',
    });
    expect(stale.ignored_stale).toBe(true);
    expect(db.prepare('SELECT status FROM call_intents WHERE id = ?').get(pendingId).status).toBe(
      'pending',
    );
  });

  it('records unknown-intent provider events as stale without FK errors', () => {
    const db = getDatabase();
    const result = reconcileProviderEvent(db, {
      provider: 'sandbox',
      providerEventId: 'pe-unknown',
      callIntentId: generateId(),
      eventType: 'call.completed',
    });
    expect(result.ignored_stale).toBe(true);
    const row = db
      .prepare('SELECT call_intent_id FROM provider_events WHERE provider_event_id = ?')
      .get('pe-unknown');
    expect(row.call_intent_id).toBeNull();
  });

  it('quota hooks allow/deny and retention is dry-run only', () => {
    const db = getDatabase();
    const { tenantId } = seedTenantAndIntent(db);
    db.prepare(
      'INSERT INTO tenant_quotas (tenant_id, resource, limit_value, used) VALUES (?, ?, ?, ?)',
    ).run(tenantId, 'calls', 1, 1);
    expect(checkQuota(db, tenantId, 'calls').allowed).toBe(false);
    expect(checkQuota(db, tenantId, 'unknown').allowed).toBe(true);
    db.prepare(
      'INSERT INTO retention_policies (tenant_id, resource, retain_days) VALUES (?, ?, ?)',
    ).run(tenantId, 'audit_events', 90);
    const report = applyRetention(db, { dryRun: true });
    expect(report).toHaveLength(1);
    expect(report[0].dry_run).toBe(true);
  });

  it('backoff is honored: failed rows are not immediately reclaimable', () => {
    const db = getDatabase();
    const { tenantId, intentId } = seedTenantAndIntent(db);
    const { row } = enqueue(db, {
      tenantId,
      aggregateType: 'call_intent',
      aggregateId: intentId,
      type: 'x',
      dedupKey: `bo-${intentId}`,
    });
    claimBatch(db, { workerId: 'w', limit: 10 });
    fail(db, row.id, 'w', 'boom');
    const immediate = claimBatch(db, { workerId: 'w2', limit: 10 });
    expect(immediate.some(r => r.id === row.id)).toBe(false);
  });

  it('audit chain remains valid after transitions (review finding)', async () => {
    const db = getDatabase();
    const { intentId } = seedTenantAndIntent(db);
    transition(db, { intentId, to: 'approved', actor: 'test' });
    const { createAuditLogger } = await import('../audit.mjs');
    const logger = createAuditLogger();
    await logger.initialize();
    const verification = await logger.verifyChain();
    expect(verification.valid).toBe(true);
  });

  it('backup and restore round-trip', () => {
    const db = getDatabase();
    const backupPath = join(TEST_DIR, 'backup.db');
    const manifest = backupDatabase(db, backupPath);
    expect(manifest.integrity_check).toBe('ok');
    const restoredPath = join(TEST_DIR, 'restored.db');
    const result = restoreDatabase(backupPath, restoredPath);
    expect(result.restored).toBe(true);
  });
});

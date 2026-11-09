/**
 * CALLFORGE AI — Audit Logger Tests
 * v0.2 Simulation Baseline
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initDatabase,
  getDatabase,
  closeStore,
  generateId,
  setTestDatabasePath,
} from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

const TEST_DB_DIR = join(process.cwd(), 'data', 'test-audit');
const TEST_DB_PATH = join(TEST_DB_DIR, 'callforge.db');

describe('Audit Logger', () => {
  let auditLogger;
  let testTenantId;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setTestDatabasePath(TEST_DB_PATH);
    await initDatabase();
  });

  afterAll(async () => {
    await closeStore();
  });

  beforeEach(async () => {
    const db = getDatabase();
    db.prepare('DELETE FROM audit_events').run();
    db.prepare('DELETE FROM tenants').run();
    testTenantId = generateId();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      testTenantId,
      'Test Tenant',
      '{}',
    );
    auditLogger = createAuditLogger();
    await auditLogger.initialize();
  });

  it('should log events with hash chaining', async () => {
    const event1 = await auditLogger.log({
      event_type: 'test_event_1',
      actor_type: 'system',
      action: 'test',
      payload: { step: 1 },
    });

    expect(event1.id).toBeDefined();
    expect(event1.previous_hash).toBe('0'.repeat(64));
    expect(event1.event_hash).toBeDefined();
    expect(event1.event_hash).toHaveLength(64);

    const event2 = await auditLogger.log({
      event_type: 'test_event_2',
      actor_type: 'system',
      action: 'test',
      payload: { step: 2 },
    });

    expect(event2.previous_hash).toBe(event1.event_hash);
    expect(event2.event_hash).not.toBe(event1.event_hash);
  });

  it('should include tenant_id when provided', async () => {
    const event = await auditLogger.log({
      tenant_id: testTenantId,
      event_type: 'tenant_event',
      actor_type: 'user',
      actor_id: 'user-123',
      action: 'create_resource',
      resource_type: 'call_intent',
      resource_id: 'intent-456',
      payload: { data: 'test' },
    });

    expect(event.tenant_id).toBe(testTenantId);
    expect(event.actor_type).toBe('user');
    expect(event.actor_id).toBe('user-123');
    expect(event.resource_type).toBe('call_intent');
    expect(event.resource_id).toBe('intent-456');
  });

  it('should store events in database', async () => {
    const db = getDatabase();

    await auditLogger.log({ event_type: 'db_test_1', actor_type: 'system', action: 'test' });
    await auditLogger.log({ event_type: 'db_test_2', actor_type: 'system', action: 'test' });

    const events = db.prepare('SELECT * FROM audit_events ORDER BY created_at').all();
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('db_test_1');
    expect(events[1].event_type).toBe('db_test_2');
  });

  it('should verify hash chain integrity', async () => {
    await auditLogger.log({ event_type: 'chain_1', actor_type: 'system', action: 'test' });
    await auditLogger.log({ event_type: 'chain_2', actor_type: 'system', action: 'test' });
    await auditLogger.log({ event_type: 'chain_3', actor_type: 'system', action: 'test' });

    const verification = await auditLogger.verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.errors).toHaveLength(0);
    expect(verification.events_checked).toBe(3);
  });

  it('should preserve chain integrity across multiple logger instances', async () => {
    const loggerA = createAuditLogger();
    const loggerB = createAuditLogger();
    await loggerA.initialize();
    await loggerB.initialize();

    await loggerA.log({ event_type: 'multi_logger_1', actor_type: 'system', action: 'test' });
    await loggerB.log({ event_type: 'multi_logger_2', actor_type: 'system', action: 'test' });
    await loggerA.log({ event_type: 'multi_logger_3', actor_type: 'system', action: 'test' });

    const verification = await loggerA.verifyChain();
    expect(verification.valid).toBe(true);
    expect(verification.errors).toHaveLength(0);
    expect(verification.events_checked).toBe(3);
  });

  it('should detect broken hash chain', async () => {
    await auditLogger.log({ event_type: 'tamper_1', actor_type: 'system', action: 'test' });
    await auditLogger.log({ event_type: 'tamper_2', actor_type: 'system', action: 'test' });

    // Tamper with the database directly
    const db = getDatabase();
    const event = db.prepare('SELECT * FROM audit_events WHERE event_type = ?').get('tamper_1');
    db.prepare('UPDATE audit_events SET payload = ? WHERE id = ?').run(
      '{"tampered":true}',
      event.id,
    );

    const verification = await auditLogger.verifyChain();
    expect(verification.valid).toBe(false);
    expect(verification.errors.length).toBeGreaterThan(0);
  });

  it('should verify a mid-chain segment without a spurious chain-broken error (issue #2)', async () => {
    await auditLogger.log({ event_type: 'partial_1', actor_type: 'system', action: 'test' });
    const mid = await auditLogger.log({ event_type: 'partial_2', actor_type: 'system', action: 'test' });
    await auditLogger.log({ event_type: 'partial_3', actor_type: 'system', action: 'test' });

    const full = await auditLogger.verifyChain();
    expect(full.valid).toBe(true);

    const partial = await auditLogger.verifyChain(mid.id);
    expect(partial.valid).toBe(true);
    expect(partial.errors).toHaveLength(0);
    expect(partial.events_checked).toBe(2);
  });

  it('should detect tampering inside a mid-chain segment (issue #2)', async () => {
    await auditLogger.log({ event_type: 'seg_1', actor_type: 'system', action: 'test' });
    const mid = await auditLogger.log({ event_type: 'seg_2', actor_type: 'system', action: 'test' });
    const tail = await auditLogger.log({ event_type: 'seg_3', actor_type: 'system', action: 'test' });

    // Tamper with the segment head's payload.
    const db = getDatabase();
    db.prepare('UPDATE audit_events SET payload = ? WHERE id = ?').run(
      '{"tampered":"mid"}',
      mid.id,
    );

    const partial = await auditLogger.verifyChain(mid.id);
    expect(partial.valid).toBe(false);
    expect(partial.errors.some(e => e.event_id === mid.id)).toBe(true);
    // Untouched tail alone is still consistent (hash mismatch upstream only
    // flags the tampered event; link check on the tail sees its stored hashes).
    expect(partial.errors.some(e => e.event_id === tail.id)).toBe(false);
  });

  it('should return deterministic order for same-timestamp events (issue #4)', async () => {
    const sameTime = '2026-11-09T04:00:00.000Z';
    for (let i = 0; i < 5; i++) {
      await auditLogger.log({
        event_type: `ts_order_${i}`,
        actor_type: 'system',
        action: 'test',
        created_at: sameTime,
      });
    }
    const events = await auditLogger.getEvents({ limit: 5 });
    expect(events.map(e => e.event_type)).toEqual([
      'ts_order_4',
      'ts_order_3',
      'ts_order_2',
      'ts_order_1',
      'ts_order_0',
    ]);
  });

  it('should retrieve events with filters', async () => {
    await auditLogger.log({
      tenant_id: testTenantId,
      event_type: 'type_a',
      actor_type: 'system',
      action: 'test',
    });
    await auditLogger.log({
      tenant_id: testTenantId,
      event_type: 'type_b',
      actor_type: 'user',
      action: 'test',
    });
    await auditLogger.log({ event_type: 'type_c', actor_type: 'system', action: 'test' });

    const tenantEvents = await auditLogger.getEvents({ tenant_id: testTenantId });
    expect(tenantEvents).toHaveLength(2);

    const systemEvents = await auditLogger.getEvents({ actor_type: 'system' });
    expect(systemEvents).toHaveLength(2); // type_a and type_c

    const typeBEvents = await auditLogger.getEvents({ event_type: 'type_b' });
    expect(typeBEvents).toHaveLength(1);
    expect(typeBEvents[0].event_type).toBe('type_b');
  });

  it('should paginate results', async () => {
    for (let i = 0; i < 9; i++) {
      await auditLogger.log({ event_type: `page_test_${i}`, actor_type: 'system', action: 'test' });
    }

    const page1 = await auditLogger.getEvents({ limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = await auditLogger.getEvents({ limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);

    const page3 = await auditLogger.getEvents({ limit: 3, offset: 6 });
    expect(page3).toHaveLength(3);
  });

  it('should return chain head', async () => {
    const headBefore = auditLogger.getChainHead();
    expect(headBefore).toBeDefined();

    const event = await auditLogger.log({
      event_type: 'head_test',
      actor_type: 'system',
      action: 'test',
    });
    const headAfter = auditLogger.getChainHead();
    expect(headAfter).toBe(event.event_hash);
  });
});

/**
 * CALLFORGE AI — Store Tests
 * v0.2 Simulation Baseline
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initDatabase,
  getDatabase,
  closeStore,
  generateId,
  nowISO,
  hashEventAsync,
} from '../store.mjs';

describe('Store', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterAll(async () => {
    await closeStore();
  });

  beforeEach(() => {
    const db = getDatabase();
    // Clean up test data
    db.prepare('DELETE FROM audit_events').run();
    db.prepare('DELETE FROM call_events').run();
    db.prepare('DELETE FROM call_intents').run();
    db.prepare('DELETE FROM business_configs').run();
    db.prepare('DELETE FROM knowledge_entries').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM tenants').run();
  });

  it('should initialize database with all tables', () => {
    const db = getDatabase();

    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `,
      )
      .all();

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('tenants');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('api_keys');
    expect(tableNames).toContain('call_intents');
    expect(tableNames).toContain('call_events');
    expect(tableNames).toContain('audit_events');
    expect(tableNames).toContain('business_configs');
    expect(tableNames).toContain('knowledge_entries');
    expect(tableNames).toContain('conversation_fixtures');
  });

  it('should create and retrieve tenant', () => {
    const db = getDatabase();
    const tenantId = generateId();

    db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      'test.example.com',
      JSON.stringify({ theme: 'dark' }),
    );

    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    expect(tenant).toBeDefined();
    expect(tenant.name).toBe('Test Tenant');
    expect(tenant.domain).toBe('test.example.com');
    expect(JSON.parse(tenant.settings)).toEqual({ theme: 'dark' });
  });

  it('should enforce unique domain constraint', () => {
    const db = getDatabase();
    const tenantId1 = generateId();
    const tenantId2 = generateId();

    db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)').run(
      tenantId1,
      'Tenant 1',
      'example.com',
      '{}',
    );

    expect(() => {
      db.prepare('INSERT INTO tenants (id, name, domain, settings) VALUES (?, ?, ?, ?)').run(
        tenantId2,
        'Tenant 2',
        'example.com',
        '{}',
      );
    }).toThrow();
  });

  it('should create and retrieve user', () => {
    const db = getDatabase();
    const tenantId = generateId();
    const userId = generateId();

    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );

    db.prepare('INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      tenantId,
      'user@example.com',
      'Test User',
      'member',
    );

    const user = db
      .prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?')
      .get(tenantId, 'user@example.com');
    expect(user).toBeDefined();
    expect(user.email).toBe('user@example.com');
    expect(user.role).toBe('member');
  });

  it('should create API key and validate hash', () => {
    const db = getDatabase();
    const tenantId = generateId();

    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );

    const keyId = generateId();
    const rawToken = 'cf_dev_test123';
    const keyHash = createHash('sha256').update(rawToken).digest('hex');

    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes) VALUES (?, ?, ?, ?, ?)',
    ).run(keyId, tenantId, 'Test Key', keyHash, JSON.stringify(['simulate', 'read']));

    const apiKey = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash);
    expect(apiKey).toBeDefined();
    expect(apiKey.tenant_id).toBe(tenantId);
    expect(JSON.parse(apiKey.scopes)).toEqual(['simulate', 'read']);
  });

  it('should create call intent with idempotency', () => {
    const db = getDatabase();
    const tenantId = generateId();
    const idempotencyKey = 'test-key-123';

    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );

    const callIntentId = generateId();
    db.prepare(
      `
      INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, language, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(callIntentId, tenantId, idempotencyKey, 'outbound', 'en', 'pending');

    // First insert should succeed
    const intent1 = db
      .prepare('SELECT * FROM call_intents WHERE tenant_id = ? AND idempotency_key = ?')
      .get(tenantId, idempotencyKey);
    expect(intent1).toBeDefined();
    expect(intent1.id).toBe(callIntentId);

    // Second insert with same idempotency key should be prevented by unique constraint
    expect(() => {
      db.prepare(
        `
        INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, language, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(generateId(), tenantId, idempotencyKey, 'inbound', 'ar', 'pending');
    }).toThrow();
  });

  it('should store and retrieve call events with sequence', () => {
    const db = getDatabase();
    const tenantId = generateId();
    const callIntentId = generateId();

    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );

    db.prepare(
      'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
    ).run(callIntentId, tenantId, 'idem-key', 'outbound', 'pending');

    const event1Id = generateId();
    db.prepare(
      `
      INSERT INTO call_events (id, call_intent_id, event_type, payload, sequence_number, previous_event_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      event1Id,
      callIntentId,
      'call_intent_created',
      JSON.stringify({}),
      0,
      '0'.repeat(64),
      'hash1',
    );

    const event2Id = generateId();
    db.prepare(
      `
      INSERT INTO call_events (id, call_intent_id, event_type, payload, sequence_number, previous_event_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      event2Id,
      callIntentId,
      'status_changed',
      JSON.stringify({ status: 'approved' }),
      1,
      'hash1',
      'hash2',
    );

    const events = db
      .prepare('SELECT * FROM call_events WHERE call_intent_id = ? ORDER BY sequence_number')
      .all(callIntentId);
    expect(events).toHaveLength(2);
    expect(events[0].sequence_number).toBe(0);
    expect(events[1].sequence_number).toBe(1);
    expect(JSON.parse(events[0].payload)).toEqual({});
    expect(JSON.parse(events[1].payload)).toEqual({ status: 'approved' });
  });

  it('should store and retrieve business config', () => {
    const db = getDatabase();
    const tenantId = generateId();

    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );

    const configId = generateId();
    db.prepare(
      `
      INSERT INTO business_configs (id, tenant_id, sector, business_name, license_number, supported_languages, calling_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      configId,
      tenantId,
      'clinic',
      'Dental Clinic',
      'LIC-12345',
      JSON.stringify(['en', 'ar']),
      JSON.stringify({ start: '09:00', end: '18:00', timezone: 'Asia/Dubai' }),
    );

    const config = db.prepare('SELECT * FROM business_configs WHERE tenant_id = ?').get(tenantId);
    expect(config).toBeDefined();
    expect(config.sector).toBe('clinic');
    expect(config.business_name).toBe('Dental Clinic');
    expect(JSON.parse(config.supported_languages)).toEqual(['en', 'ar']);
    expect(JSON.parse(config.calling_hours).start).toBe('09:00');
  });

  it('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('should return valid ISO timestamp', () => {
    const timestamp = nowISO();
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(timestamp).toString()).not.toBe('Invalid Date');
  });

  it('should hash events consistently', async () => {
    const event = { id: 'test-1', type: 'test', data: { value: 123 } };
    const hash1 = await hashEventAsync(event);
    const hash2 = await hashEventAsync(event);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('should produce different hashes for different events', async () => {
    const event1 = { id: 'test-1', type: 'test', data: { value: 123 } };
    const event2 = { id: 'test-2', type: 'test', data: { value: 123 } };
    const hash1 = await hashEventAsync(event1);
    const hash2 = await hashEventAsync(event2);
    expect(hash1).not.toBe(hash2);
  });
});

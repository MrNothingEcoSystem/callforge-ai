/**
 * CALLFORGE AI — Auth Middleware Tests
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
import { createAuthMiddleware } from '../auth.mjs';
import { join } from 'path';
import { mkdirSync } from 'fs';

const TEST_DB_DIR = join(process.cwd(), 'data', 'test-auth');
const TEST_DB_PATH = join(TEST_DB_DIR, 'callforge.db');

describe('Auth Middleware', () => {
  let authMiddleware;
  let tenantId;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setTestDatabasePath(TEST_DB_PATH);
    await initDatabase();
    authMiddleware = createAuthMiddleware();
  });

  afterAll(async () => {
    await closeStore();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM tenants').run();

    tenantId = generateId();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'Test Tenant',
      '{}',
    );
  });

  it('should reject missing authorization header', async () => {
    const result = await authMiddleware.validateToken(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing or invalid Authorization header');
  });

  it('should reject invalid authorization format', async () => {
    const result = await authMiddleware.validateToken('InvalidFormat token123');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing or invalid Authorization header');
  });

  it('should reject unknown token', async () => {
    const result = await authMiddleware.validateToken('Bearer cf_dev_unknown_token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid token');
  });

  it('should create and validate dev token', async () => {
    const tokenResult = await authMiddleware.createDevToken(
      tenantId,
      'Test Token',
      ['simulate', 'read'],
      30,
    );

    expect(tokenResult.token).toBeDefined();
    expect(tokenResult.token).toMatch(/^cf_dev_[a-f0-9]+$/);
    expect(tokenResult.keyId).toBeDefined();
    expect(tokenResult.expiresAt).toBeDefined();
    expect(tokenResult.scopes).toEqual(['simulate', 'read']);

    // Validate the created token
    const authHeader = `Bearer ${tokenResult.token}`;
    const validation = await authMiddleware.validateToken(authHeader);

    expect(validation.valid).toBe(true);
    expect(validation.tenant.id).toBe(tenantId);
    expect(validation.tenant.name).toBe('Test Tenant');
    expect(validation.scopes).toEqual(['simulate', 'read']);
    expect(validation.keyId).toBe(tokenResult.keyId);
  });

  it('should update last_used_at on validation', async () => {
    const tokenResult = await authMiddleware.createDevToken(
      tenantId,
      'Test Token',
      ['simulate'],
      30,
    );

    const db = getDatabase();
    const keyBefore = db
      .prepare('SELECT last_used_at FROM api_keys WHERE id = ?')
      .get(tokenResult.keyId);
    expect(keyBefore.last_used_at).toBeNull();

    await authMiddleware.validateToken(`Bearer ${tokenResult.token}`);

    const keyAfter = db
      .prepare('SELECT last_used_at FROM api_keys WHERE id = ?')
      .get(tokenResult.keyId);
    expect(keyAfter.last_used_at).not.toBeNull();
  });

  it('should reject expired token', async () => {
    // Create token with past expiration
    const db = getDatabase();
    const keyId = generateId();
    const rawToken = 'cf_dev_expired_token';
    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(keyId, tenantId, 'Expired Token', keyHash, JSON.stringify(['simulate']), expiredAt);

    const result = await authMiddleware.validateToken(`Bearer ${rawToken}`);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token expired');
  });

  it('should handle multiple tokens for same tenant', async () => {
    const token1 = await authMiddleware.createDevToken(tenantId, 'Token 1', ['simulate'], 30);
    const token2 = await authMiddleware.createDevToken(tenantId, 'Token 2', ['read', 'write'], 30);

    const validation1 = await authMiddleware.validateToken(`Bearer ${token1.token}`);
    expect(validation1.valid).toBe(true);
    expect(validation1.scopes).toEqual(['simulate']);

    const validation2 = await authMiddleware.validateToken(`Bearer ${token2.token}`);
    expect(validation2.valid).toBe(true);
    expect(validation2.scopes).toEqual(['read', 'write']);
  });

  it('should extract tenant context from request', async () => {
    const tokenResult = await authMiddleware.createDevToken(
      tenantId,
      'Test Token',
      ['simulate'],
      30,
    );

    const req = {
      headers: {
        authorization: `Bearer ${tokenResult.token}`,
      },
    };

    const tenantContext = await authMiddleware.getTenantContext(req);
    expect(tenantContext).toBeDefined();
    expect(tenantContext.id).toBe(tenantId);
    expect(tenantContext.name).toBe('Test Tenant');
  });

  it('should return null for invalid request', async () => {
    const req = { headers: {} };
    const tenantContext = await authMiddleware.getTenantContext(req);
    expect(tenantContext).toBeNull();
  });

  it('should require scopes (placeholder for M02)', async () => {
    const tokenResult = await authMiddleware.createDevToken(
      tenantId,
      'Test Token',
      ['simulate'],
      30,
    );
    const validation = await authMiddleware.validateToken(`Bearer ${tokenResult.token}`);

    const requireScopes = authMiddleware.requireScopes('simulate', 'read');
    const authResult = await requireScopes(validation.tenant);

    expect(authResult.authorized).toBe(true);
  });
});

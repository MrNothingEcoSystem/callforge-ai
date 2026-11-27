import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
process.env.CALLFORGE_ALLOW_DEV_SECRET ??= 'true';
import { CallforgeHttpServer } from '../server.mjs';
import { generateCodeVerifier, pkceS256 } from '../oauth.mjs';
import {
  closeStore,
  generateId,
  getDatabase,
  initDatabase,
  setTestDatabasePath,
} from '../store.mjs';
import { readTenantPolicy } from '../policies/tenantPolicy.mjs';

const DIR = join(process.cwd(), 'data', 'test-tenant-policy-api');
const DB_PATH = join(DIR, 'callforge.db');

const VALID = {
  callingWindow: { startHour: 7, endHour: 18 },
  retryLimits: { day: 2, week: 3 },
  dncrMaxAgeHours: 24,
};

function createResponse() {
  return {
    statusCode: null,
    body: '',
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

function requestWith(token, body) {
  const req = new EventEmitter();
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  setImmediate(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    }
    req.emit('end');
  });
  return req;
}

function tokenFor(server, tenantId, role = 'tenant_admin') {
  const verifier = generateCodeVerifier();
  const auth = server.oauth.authorize({
    tenant_id: tenantId,
    role,
    scope: role === 'tenant_admin' ? ['admin', 'read'] : ['read'],
    code_challenge: pkceS256(verifier),
    code_challenge_method: 'S256',
  });
  return server.oauth.exchange({ code: auth.code, code_verifier: verifier }).access_token;
}

describe('tenant policy HTTP surface (review #197 F3)', () => {
  let server;
  let adminToken;
  let tenantId;
  let otherTenantId;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    setTestDatabasePath(DB_PATH);
    await initDatabase();
    server = new CallforgeHttpServer();
    server.auditLogger = { log: async () => {} };
    tenantId = generateId();
    otherTenantId = generateId();
    const db = getDatabase();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      tenantId,
      'A',
      '{}',
    );
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      otherTenantId,
      'B',
      '{}',
    );
    adminToken = tokenFor(server, tenantId);
  });

  beforeEach(() => {
    getDatabase().prepare('DELETE FROM tenant_policies').run();
  });

  afterAll(async () => {
    await closeStore();
  });

  it('rejects an unauthenticated read', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(null), res, 'GET');
    expect(res.statusCode).toBe(401);
  });

  it('reports the statutory defaults when no row is stored', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken), res, 'GET');
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.source).toBe('default');
    expect(payload.policy.callingWindow).toEqual({ startHour: 9, endHour: 18 });
  });

  it('requires the admin scope to write', async () => {
    const operatorToken = tokenFor(server, tenantId, 'operator');
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(operatorToken, VALID), res, 'PUT');
    expect(res.statusCode).toBe(403);
    expect(readTenantPolicy(getDatabase(), tenantId).source).toBe('default');
  });

  it('stores a valid policy and serves it back as tenant-sourced', async () => {
    const write = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, VALID), write, 'PUT');
    expect(write.statusCode).toBe(200);
    expect(JSON.parse(write.body).source).toBe('tenant');

    const read = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken), read, 'GET');
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(read.body).policy.callingWindow).toEqual({ startHour: 7, endHour: 18 });
  });

  it('accepts the policy nested under `policy`', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, { policy: VALID }), res, 'PUT');
    expect(res.statusCode).toBe(200);
  });

  it('rejects unusable values and keeps the stored row unchanged', async () => {
    await server.handleTenantPolicy(requestWith(adminToken, VALID), createResponse(), 'PUT');
    const bad = { ...VALID, callingWindow: { startHour: 18, endHour: 7 } };
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, bad), res, 'PUT');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).violations.length).toBeGreaterThan(0);
    expect(readTenantPolicy(getDatabase(), tenantId).options.callingWindow).toEqual({
      startHour: 7,
      endHour: 18,
    });
  });

  it('rejects a body tenant that disagrees with the token', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...VALID, tenant_id: otherTenantId }),
      res,
      'PUT',
    );
    expect(res.statusCode).toBe(403);
    expect(readTenantPolicy(getDatabase(), otherTenantId).source).toBe('default');
  });

  it('rejects a malformed JSON body', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, '{not json'), res, 'PUT');
    expect(res.statusCode).toBe(400);
  });

  it('answers 409 when the stored row is corrupt (no silent defaults)', async () => {
    await server.handleTenantPolicy(requestWith(adminToken, VALID), createResponse(), 'PUT');
    // Inverted window passes the table CHECK but fails validation.
    getDatabase()
      .prepare('UPDATE tenant_policies SET window_start_hour = 18, window_end_hour = 7')
      .run();
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken), res, 'GET');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).policy).toBeNull();
  });

  it('audits the write with the applied policy', async () => {
    const logged = [];
    server.auditLogger = { log: async entry => logged.push(entry) };
    await server.handleTenantPolicy(requestWith(adminToken, VALID), createResponse(), 'PUT');
    server.auditLogger = { log: async () => {} };
    expect(logged).toHaveLength(1);
    expect(logged[0].event_type).toBe('tenant_policy_updated');
    expect(logged[0].payload.policy.callingWindow.startHour).toBe(7);
  });
});

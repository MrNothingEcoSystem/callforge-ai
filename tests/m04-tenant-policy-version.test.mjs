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
import { readTenantPolicy, writeTenantPolicy } from '../policies/tenantPolicy.mjs';

const DIR = join(process.cwd(), 'data', 'test-tenant-policy-version');
const DB_PATH = join(DIR, 'callforge.db');

const VALID = {
  callingWindow: { startHour: 7, endHour: 18 },
  retryLimits: { day: 2, week: 3 },
  dncrMaxAgeHours: 24,
};
const OTHER = {
  callingWindow: { startHour: 10, endHour: 20 },
  retryLimits: { day: 3, week: 6 },
  dncrMaxAgeHours: 12,
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

function requestWith(token, body, extraHeaders = {}) {
  const req = new EventEmitter();
  req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders };
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

function revisionCount(tenantId) {
  return getDatabase()
    .prepare('SELECT COUNT(*) AS n FROM tenant_policy_revisions WHERE tenant_id = ?')
    .get(tenantId).n;
}

describe('tenant policy version fence (TECH-014, concurrent PUTs)', () => {
  let server;
  let adminToken;
  let tenantId;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    setTestDatabasePath(DB_PATH);
    await initDatabase();
    server = new CallforgeHttpServer();
    server.auditLogger = { log: async () => {} };
    tenantId = generateId();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)')
      .run(tenantId, 'A', '{}');
    adminToken = tokenFor(server, tenantId);
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM tenant_policies').run();
    db.prepare('DELETE FROM tenant_policy_revisions').run();
  });

  afterAll(async () => {
    await closeStore();
  });

  /** Seed an existing override at version 1 (the raw SQL keeps revision rows out of it). */
  function seed() {
    writeTenantPolicy(getDatabase(), tenantId, VALID);
    expect(readTenantPolicy(getDatabase(), tenantId).version).toBe(1);
  }

  it('starts a fresh tenant at version 0 with the defaults', () => {
    expect(readTenantPolicy(getDatabase(), tenantId).version).toBe(0);
  });

  it('creates the row at version 1 under a version-1 fence', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, { ...VALID, version: 1 }), res, 'PUT');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).version).toBe(1);
    expect(readTenantPolicy(getDatabase(), tenantId).source).toBe('tenant');
  });

  it('applies a fenced write whose version matches and bumps the version', async () => {
    seed();
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, { ...OTHER, version: 1 }), res, 'PUT');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).version).toBe(2);
    expect(readTenantPolicy(getDatabase(), tenantId).options.callingWindow).toEqual({
      startHour: 10,
      endHour: 20,
    });
  });

  it('rejects the loser of a concurrent pair with 409 and keeps the winner', async () => {
    const db = getDatabase();
    // Both operators read version 1; the winner applies first.
    seed();

    const winner = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...VALID, version: 1 }),
      winner,
      'PUT',
    );
    expect(winner.statusCode).toBe(200);
    expect(revisionCount(tenantId)).toBe(1);

    const stale = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...OTHER, version: 1 }),
      stale,
      'PUT',
    );
    expect(stale.statusCode).toBe(409);
    const body = JSON.parse(stale.body);
    expect(body.version).toBe(2);
    // The response carries the current policy so the caller can retry on it.
    expect(body.policy.callingWindow).toEqual({ startHour: 7, endHour: 18 });
    const stored = readTenantPolicy(db, tenantId);
    expect(stored.version).toBe(2);
    expect(stored.options.callingWindow).toEqual({ startHour: 7, endHour: 18 });
    // A rejected write must not leave a history row pretending it applied.
    expect(revisionCount(tenantId)).toBe(1);
  });

  it('lets the stale writer retry with the fresh version and win', async () => {
    const db = getDatabase();
    seed();
    const first = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...OTHER, version: 1 }),
      first,
      'PUT',
    );
    expect(first.statusCode).toBe(200);

    const stale = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...VALID, version: 1 }),
      stale,
      'PUT',
    );
    expect(stale.statusCode).toBe(409);

    const retry = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...VALID, version: 2 }),
      retry,
      'PUT',
    );
    expect(retry.statusCode).toBe(200);
    expect(JSON.parse(retry.body).version).toBe(3);
    expect(readTenantPolicy(db, tenantId).options.callingWindow).toEqual({
      startHour: 7,
      endHour: 18,
    });
  });

  it('honours If-Match as the fence', async () => {
    seed();
    const fresh = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, OTHER, { 'if-match': '"1"' }),
      fresh,
      'PUT',
    );
    expect(fresh.statusCode).toBe(200);
    expect(JSON.parse(fresh.body).version).toBe(2);

    const stale = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, VALID, { 'if-match': 'W/"1"' }),
      stale,
      'PUT',
    );
    expect(stale.statusCode).toBe(409);
  });

  it('is unconditional when no version is supplied (last write wins)', async () => {
    const db = getDatabase();
    seed();
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, OTHER), res, 'PUT');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).version).toBe(2);
    expect(readTenantPolicy(db, tenantId).options.callingWindow).toEqual({
      startHour: 10,
      endHour: 20,
    });
  });

  it('serves the stored version on GET', async () => {
    seed();
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken), res, 'GET');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).version).toBe(1);
  });

  it('refuses a fence above 1 for a tenant with no override row', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken, { ...VALID, version: 2 }), res, 'PUT');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).version).toBe(0);
    expect(readTenantPolicy(getDatabase(), tenantId).source).toBe('default');
  });

  it('leaves a junk fence on the unfenced path', async () => {
    const res = createResponse();
    await server.handleTenantPolicy(
      requestWith(adminToken, { ...VALID, version: 'abc' }),
      res,
      'PUT',
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).version).toBe(1);
  });
});

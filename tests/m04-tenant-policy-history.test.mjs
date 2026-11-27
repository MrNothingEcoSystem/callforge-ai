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

const DIR = join(process.cwd(), 'data', 'test-tenant-policy-history');
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

describe('tenant policy history (TECH-014 follow-up)', () => {
  let server;
  let adminToken;
  let operatorToken;
  let tenantId;
  let otherTenantId;
  let otherToken;

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
    operatorToken = tokenFor(server, tenantId, 'operator');
    otherToken = tokenFor(server, otherTenantId);
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM tenant_policies').run();
    db.prepare('DELETE FROM tenant_policy_revisions').run();
  });

  afterAll(async () => {
    await closeStore();
  });

  async function write(token, body) {
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(token, body), res, 'PUT');
    return res;
  }

  async function history(token = adminToken, limit) {
    const res = createResponse();
    const query = new URLSearchParams();
    if (limit !== undefined) {
      query.set('limit', String(limit));
    }
    await server.handleTenantPolicyHistory(requestWith(token), res, query);
    return res;
  }

  it('rejects an unauthenticated read', async () => {
    const res = await history(null);
    expect(res.statusCode).toBe(401);
  });

  it('is readable with the read scope alone', async () => {
    const res = await history(operatorToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).entries).toEqual([]);
  });

  it('records an accepted write with the applied policy', async () => {
    await write(adminToken, VALID);
    const res = await history();
    expect(res.statusCode).toBe(200);
    const { entries } = JSON.parse(res.body);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('updated');
    expect(entries[0].policy.callingWindow).toEqual({ startHour: 7, endHour: 18 });
    expect(typeof entries[0].actor_id).toBe('string');
    expect(entries[0].actor_id.length).toBeGreaterThan(0);
  });

  it('records nothing for a rejected write', async () => {
    const res = await write(adminToken, { ...VALID, callingWindow: { startHour: 18, endHour: 7 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse((await history()).body).entries).toEqual([]);
  });

  it('records the reverted policy and keeps the entry after the row is gone', async () => {
    await write(adminToken, VALID);
    const revert = createResponse();
    await server.handleTenantPolicy(requestWith(adminToken), revert, 'DELETE');
    expect(revert.statusCode).toBe(200);

    const res = await history();
    const { entries } = JSON.parse(res.body);
    expect(entries.map(e => e.action)).toEqual(['reverted', 'updated']);
    expect(entries[0].policy.callingWindow).toEqual({ startHour: 7, endHour: 18 });
    expect(getDatabase().prepare('SELECT count(*) AS n FROM tenant_policies').get().n).toBe(0);
  });

  it('records the violations when a corrupt row is reverted', async () => {
    await write(adminToken, VALID);
    getDatabase()
      .prepare('UPDATE tenant_policies SET window_start_hour = 18, window_end_hour = 7')
      .run();
    await server.handleTenantPolicy(requestWith(adminToken), createResponse(), 'DELETE');
    const { entries } = JSON.parse((await history()).body);
    expect(entries[0].action).toBe('reverted');
    expect(entries[0].policy).toBeNull();
    expect(entries[0].violations.length).toBeGreaterThan(0);
  });

  it('records nothing for an idempotent revert', async () => {
    await server.handleTenantPolicy(requestWith(adminToken), createResponse(), 'DELETE');
    expect(JSON.parse((await history()).body).entries).toEqual([]);
  });

  it('is newest-first and honours the limit', async () => {
    await write(adminToken, VALID);
    await write(adminToken, OTHER);
    const res = await history(adminToken, 1);
    const body = JSON.parse(res.body);
    expect(body.limit).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].policy.callingWindow.startHour).toBe(10);
  });

  it('clamps an out-of-range or unparsable limit', async () => {
    expect(JSON.parse((await history(adminToken, 0)).body).limit).toBe(1);
    expect(JSON.parse((await history(adminToken, 9999)).body).limit).toBe(200);
    expect(JSON.parse((await history(adminToken, 'abc')).body).limit).toBe(50);
  });

  it('never shows another tenant history', async () => {
    await write(adminToken, VALID);
    await write(otherToken, OTHER);
    const mine = JSON.parse((await history()).body).entries;
    expect(mine).toHaveLength(1);
    expect(mine[0].policy.callingWindow.startHour).toBe(7);
  });

  it('reads the limit from the plain query object the router builds', async () => {
    await write(adminToken, VALID);
    await write(adminToken, OTHER);
    const res = createResponse();
    await server.handleTenantPolicyHistory(requestWith(adminToken), res, { limit: '1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).entries).toHaveLength(1);
  });

  it('audits the write and the revert with an actor_type the schema allows', async () => {
    // `audit_events.actor_type` is CHECK-constrained; `client` was rejected and
    // every real-server PUT/DELETE answered 500 while tests stubbed the logger.
    const allowed = ['system', 'user', 'agent', 'provider'];
    const logged = [];
    server.auditLogger = { log: async entry => logged.push(entry) };
    await write(adminToken, VALID);
    await server.handleTenantPolicy(requestWith(adminToken), createResponse(), 'DELETE');
    server.auditLogger = { log: async () => {} };
    expect(logged.map(e => e.event_type)).toEqual([
      'tenant_policy_updated',
      'tenant_policy_reverted',
    ]);
    for (const entry of logged) {
      expect(allowed).toContain(entry.actor_type);
    }
  });

  it('reports a hand-edited snapshot as a policy violation, not a crash', async () => {
    await write(adminToken, VALID);
    getDatabase().prepare("UPDATE tenant_policy_revisions SET policy_json = '{oops'").run();
    const res = await history();
    expect(res.statusCode).toBe(200);
    const { entries } = JSON.parse(res.body);
    expect(entries[0].policy).toBeNull();
    expect(entries[0].violations.join(' ')).toMatch(/not valid JSON/);
  });
});

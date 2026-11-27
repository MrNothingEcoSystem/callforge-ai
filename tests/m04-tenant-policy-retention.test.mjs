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
import {
  HISTORY_LIMIT_MAX,
  POLICY_REVISION_RETENTION,
  readPolicyHistory,
  recordPolicyRevision,
} from '../policies/tenantPolicy.mjs';

const DIR = join(process.cwd(), 'data', 'test-tenant-policy-retention');
const DB_PATH = join(DIR, 'callforge.db');
const VALID = {
  callingWindow: { startHour: 7, endHour: 18 },
  retryLimits: { day: 2, week: 3 },
  dncrMaxAgeHours: 24,
};
const OVER = POLICY_REVISION_RETENTION + 25;

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

function tokenFor(server, tenantId) {
  const verifier = generateCodeVerifier();
  const auth = server.oauth.authorize({
    tenant_id: tenantId,
    role: 'tenant_admin',
    scope: ['admin', 'read'],
    code_challenge: pkceS256(verifier),
    code_challenge_method: 'S256',
  });
  return server.oauth.exchange({ code: auth.code, code_verifier: verifier }).access_token;
}

describe('tenant policy revision retention (TECH-014 follow-up)', () => {
  let server;
  let token;
  let tenantId;
  let otherTenantId;

  const db = () => getDatabase();
  const count = id =>
    db().prepare('SELECT COUNT(*) AS n FROM tenant_policy_revisions WHERE tenant_id = ?').get(id).n;

  function seed(id, n, startHour = 7) {
    for (let i = 0; i < n; i += 1) {
      recordPolicyRevision(db(), id, {
        action: 'updated',
        policy: { ...VALID, callingWindow: { startHour, endHour: 18 } },
        actorId: 'seed',
      });
    }
  }

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    setTestDatabasePath(DB_PATH);
    await initDatabase();
    server = new CallforgeHttpServer();
    server.auditLogger = { log: async () => {} };
    tenantId = generateId();
    otherTenantId = generateId();
    db()
      .prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)')
      .run(tenantId, 'A', '{}');
    db()
      .prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)')
      .run(otherTenantId, 'B', '{}');
    token = tokenFor(server, tenantId);
  });

  beforeEach(() => {
    db().prepare('DELETE FROM tenant_policies').run();
    db().prepare('DELETE FROM tenant_policy_revisions').run();
  });

  afterAll(async () => {
    await closeStore();
  });

  it('keeps the newest entries and drops everything past the retention bound', () => {
    seed(tenantId, OVER);
    expect(count(tenantId)).toBe(POLICY_REVISION_RETENTION);
    const newest = db()
      .prepare('SELECT MAX(id) AS id FROM tenant_policy_revisions WHERE tenant_id = ?')
      .get(tenantId).id;
    const oldestKept = db()
      .prepare('SELECT MIN(id) AS id FROM tenant_policy_revisions WHERE tenant_id = ?')
      .get(tenantId).id;
    expect(newest).toBe(oldestKept + POLICY_REVISION_RETENTION - 1);
    expect(readPolicyHistory(db(), tenantId, 1).entries).toHaveLength(1);
  });

  it('bounds each tenant independently', () => {
    seed(tenantId, OVER);
    seed(otherTenantId, 3, 10);
    expect(count(tenantId)).toBe(POLICY_REVISION_RETENTION);
    expect(count(otherTenantId)).toBe(3);
    expect(
      readPolicyHistory(db(), otherTenantId, 5).entries[0].policy.callingWindow.startHour,
    ).toBe(10);
  });

  it('still serves a maximal history page after pruning', () => {
    seed(tenantId, OVER);
    const body = readPolicyHistory(db(), tenantId, HISTORY_LIMIT_MAX);
    expect(body.limit).toBe(HISTORY_LIMIT_MAX);
    expect(body.entries).toHaveLength(HISTORY_LIMIT_MAX);
  });

  it('prunes on an accepted API write too', async () => {
    seed(tenantId, OVER);
    const res = createResponse();
    await server.handleTenantPolicy(requestWith(token, VALID), res, 'PUT');
    expect(res.statusCode).toBe(200);
    expect(count(tenantId)).toBe(POLICY_REVISION_RETENTION);
  });

  it('does not prune on a rejected write', async () => {
    seed(tenantId, POLICY_REVISION_RETENTION);
    const res = createResponse();
    await server.handleTenantPolicy(
      requestWith(token, { ...VALID, callingWindow: { startHour: 18, endHour: 7 } }),
      res,
      'PUT',
    );
    expect(res.statusCode).toBe(400);
    expect(count(tenantId)).toBe(POLICY_REVISION_RETENTION);
  });
});

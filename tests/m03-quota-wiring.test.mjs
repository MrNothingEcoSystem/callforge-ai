import { afterAll, beforeAll, describe, expect, it } from 'vitest';
process.env.CALLFORGE_ALLOW_DEV_SECRET ??= 'true';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { CallforgeHttpServer } from '../server.mjs';
import { pkceS256, generateCodeVerifier } from '../oauth.mjs';
import { generateId, getDatabase, setTestDatabasePath } from '../store.mjs';
import { transition } from '../workflow/stateMachine.mjs';

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), 'callforge-m03-quota-'));
const TEST_DB_PATH = join(TEST_DB_DIR, 'callforge.db');

function request(port, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => {
          data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function issueToken(server, tenantId) {
  const verifier = generateCodeVerifier();
  const auth = server.oauth.authorize({
    tenant_id: tenantId,
    role: 'operator',
    scope: ['simulate', 'read'],
    code_challenge: pkceS256(verifier),
    code_challenge_method: 'S256',
  });
  if (auth.error) {
    throw new Error(auth.error);
  }
  const token = server.oauth.exchange({ code: auth.code, code_verifier: verifier });
  if (token.error) {
    throw new Error(token.error);
  }
  return token.access_token;
}

describe('M03-2a quota wiring (POST /simulate/call + stateMachine)', () => {
  const tenant = generateId();
  const unlimitedTenant = generateId();
  let server;
  let port;
  let token;
  let unlimitedToken;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setTestDatabasePath(TEST_DB_PATH);
    server = new CallforgeHttpServer();
    await server.initialize();
    const db = getDatabase();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenant, 'Q', '{}');
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(
      unlimitedTenant,
      'U',
      '{}',
    );
    db.prepare(
      'INSERT INTO tenant_quotas (tenant_id, resource, limit_value, used) VALUES (?, ?, ?, ?)',
    ).run(tenant, 'call_intents', 1, 0);
    token = await issueToken(server, tenant);
    unlimitedToken = await issueToken(server, unlimitedTenant);
    server.server = http.createServer((req, res) => {
      server.routeRequest(
        req,
        res,
        new URL(req.url, 'http://x').pathname,
        req.method,
        Object.fromEntries(new URL(req.url, 'http://x').searchParams),
      );
    });
    await new Promise(resolve => server.server.listen(0, resolve));
    port = server.server.address().port;
  });

  afterAll(async () => {
    if (server?.server) {
      await new Promise(r => server.server.close(r));
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('first call consumes the single quota unit; second is denied 429', async () => {
    const first = await request(port, 'POST', '/simulate/call', {
      token,
      body: { idempotency_key: 'q-1', direction: 'outbound' },
    });
    expect(first.status).toBe(201);
    expect(first.body.idempotent).toBe(false);
    const used = getDatabase()
      .prepare('SELECT used FROM tenant_quotas WHERE tenant_id = ?')
      .get(tenant).used;
    expect(used).toBe(1);

    const second = await request(port, 'POST', '/simulate/call', {
      token,
      body: { idempotency_key: 'q-2', direction: 'outbound' },
    });
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('quota_exceeded');
    // no intent was created for the denied call
    const count = getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM call_intents WHERE tenant_id = ?')
      .get(tenant).n;
    expect(count).toBe(1);
  });

  it('transition to rejected releases the quota unit', async () => {
    const db = getDatabase();
    const intent = db
      .prepare('SELECT id FROM call_intents WHERE tenant_id = ? AND idempotency_key = ?')
      .get(tenant, 'q-1');
    const result = transition(db, { intentId: intent.id, to: 'rejected', actor: 'test' });
    expect(result.to).toBe('rejected');
    const used = db.prepare('SELECT used FROM tenant_quotas WHERE tenant_id = ?').get(tenant).used;
    expect(used).toBe(0);
  });

  it('after release, a new call succeeds and consumes again', async () => {
    const res = await request(port, 'POST', '/simulate/call', {
      token,
      body: { idempotency_key: 'q-3', direction: 'outbound' },
    });
    expect(res.status).toBe(201);
    const used = getDatabase()
      .prepare('SELECT used FROM tenant_quotas WHERE tenant_id = ?')
      .get(tenant).used;
    expect(used).toBe(1);
  });

  it('tenant without a quota rule is unlimited (F-M03-2c default)', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(port, 'POST', '/simulate/call', {
        token: unlimitedToken,
        body: { idempotency_key: `u-${i}`, direction: 'outbound' },
      });
      expect(res.status).toBe(201);
    }
  });
});

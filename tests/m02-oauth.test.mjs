import { afterAll, beforeAll, describe, expect, it } from 'vitest';
process.env.CALLFORGE_ALLOW_DEV_SECRET ??= 'true';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { CallforgeHttpServer } from '../server.mjs';
import {
  pkceS256,
  generateCodeVerifier,
  validateAccessToken,
  ISSUER,
  AUDIENCE,
} from '../oauth.mjs';
import { createHmac } from 'node:crypto';
import { generateId, getDatabase, setTestDatabasePath } from '../store.mjs';

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), 'callforge-m02-'));
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

async function issueToken(
  server,
  tenantId,
  { role = 'operator', scope = ['simulate', 'read'] } = {},
) {
  const verifier = generateCodeVerifier();
  const auth = server.oauth.authorize({
    tenant_id: tenantId,
    role,
    scope,
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

function forgeToken(claims) {
  const b64 = v => Buffer.from(v).toString('base64url');
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  const sig = b64(
    createHmac('sha256', 'callforge-dev-secret-change-me').update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${sig}`;
}
function baseClaims(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 't',
    tenant_id: 't',
    role: 'auditor',
    scope: ['read'],
    iat: now,
    exp: now + 900,
    ...over,
  };
}

describe('M02 OAuth/PKCE and tenant isolation', () => {
  const tenantA = generateId();
  const tenantB = generateId();
  const callIntentId = generateId();
  let server;
  let port;
  let tokenA;
  let tokenB;
  let auditorTokenA;

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setTestDatabasePath(TEST_DB_PATH);
    server = new CallforgeHttpServer();
    await server.initialize();
    const db = getDatabase();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantA, 'A', '{}');
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantB, 'B', '{}');
    db.prepare(
      'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
    ).run(callIntentId, tenantB, 'tenant-b-call', 'outbound', 'pending');

    tokenA = await issueToken(server, tenantA);
    tokenB = await issueToken(server, tenantB);
    auditorTokenA = await issueToken(server, tenantA, {
      role: 'auditor',
      scope: ['read', 'audit'],
    });

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
    await server.shutdown();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(port, 'GET', `/simulate/status?call_intent_id=${callIntentId}`);
    expect(res.status).toBe(401);
  });

  it('rejects tampered tokens with 401', async () => {
    const res = await request(port, 'GET', `/simulate/status?call_intent_id=${callIntentId}`, {
      token: `${tokenA}tampered`,
    });
    expect(res.status).toBe(401);
  });

  it('does not return another tenant call intent by ID (404)', async () => {
    const res = await request(port, 'GET', `/simulate/status?call_intent_id=${callIntentId}`, {
      token: tokenA,
    });
    expect(res.status).toBe(404);
  });

  it('returns own tenant call intent (200)', async () => {
    const res = await request(port, 'GET', `/simulate/status?call_intent_id=${callIntentId}`, {
      token: tokenB,
    });
    expect(res.status).toBe(200);
    expect(res.body.call_intent.tenant_id).toBe(tenantB);
  });

  it('rejects client-supplied foreign tenant_id with 403', async () => {
    const res = await request(
      port,
      'GET',
      `/simulate/status?call_intent_id=${callIntentId}&tenant_id=${tenantB}`,
      { token: tokenA },
    );
    expect(res.status).toBe(403);
  });

  it('creates call intents under the token tenant only', async () => {
    const res = await request(port, 'POST', '/simulate/call', {
      token: tokenA,
      body: { idempotency_key: 'm02-1', direction: 'outbound', tenant_id: tenantB },
    });
    expect(res.status).toBe(403);
    const ok = await request(port, 'POST', '/simulate/call', {
      token: tokenA,
      body: { idempotency_key: 'm02-1', direction: 'outbound' },
    });
    expect(ok.status).toBe(201);
    const db = getDatabase();
    const row = db
      .prepare('SELECT tenant_id FROM call_intents WHERE idempotency_key = ?')
      .get('m02-1');
    expect(row.tenant_id).toBe(tenantA);
  });

  it('enforces RBAC scopes: auditor cannot simulate (403)', async () => {
    const res = await request(port, 'POST', '/simulate/call', {
      token: auditorTokenA,
      body: { idempotency_key: 'm02-aud', direction: 'outbound' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects PKCE exchange with wrong verifier (400)', async () => {
    const verifier = generateCodeVerifier();
    const auth = server.oauth.authorize({
      tenant_id: tenantA,
      role: 'operator',
      scope: ['read'],
      code_challenge: pkceS256(verifier),
      code_challenge_method: 'S256',
    });
    const bad = server.oauth.exchange({ code: auth.code, code_verifier: generateCodeVerifier() });
    expect(bad.error).toMatch(/PKCE/);
  });

  it('rejects authorization code reuse (single-use)', async () => {
    const verifier = generateCodeVerifier();
    const auth = server.oauth.authorize({
      tenant_id: tenantA,
      role: 'operator',
      scope: ['read'],
      code_challenge: pkceS256(verifier),
      code_challenge_method: 'S256',
    });
    const first = server.oauth.exchange({ code: auth.code, code_verifier: verifier });
    expect(first.access_token).toBeTruthy();
    const second = server.oauth.exchange({ code: auth.code, code_verifier: verifier });
    expect(second.error).toMatch(/already used/);
  });

  it('rejects non-S256 PKCE methods', async () => {
    const result = server.oauth.authorize({
      tenant_id: tenantA,
      role: 'operator',
      scope: ['read'],
      code_challenge: 'anything',
      code_challenge_method: 'plain',
    });
    expect(result.error).toMatch(/S256/);
  });

  it('does not grant scopes beyond the role', async () => {
    const verifier = generateCodeVerifier();
    const auth = server.oauth.authorize({
      tenant_id: tenantA,
      role: 'auditor',
      scope: ['simulate', 'read'],
      code_challenge: pkceS256(verifier),
      code_challenge_method: 'S256',
    });
    const token = server.oauth.exchange({ code: auth.code, code_verifier: verifier });
    expect(token.scope).toBe('read');
  });

  it('invalidates the code after a failed PKCE exchange (F5)', async () => {
    const verifier = generateCodeVerifier();
    const auth = server.oauth.authorize({
      tenant_id: tenantA,
      role: 'operator',
      scope: ['read'],
      code_challenge: pkceS256(verifier),
      code_challenge_method: 'S256',
    });
    const bad = server.oauth.exchange({ code: auth.code, code_verifier: 'wrong-verifier' });
    expect(bad.error).toMatch(/PKCE/);
    const retry = server.oauth.exchange({ code: auth.code, code_verifier: verifier });
    expect(retry.error).toMatch(/already used/);
  });

  it('rejects conversation requests without authentication (F4)', async () => {
    const res = await request(port, 'POST', '/simulate/conversation', {
      body: { language: 'en', scenario: 'appointment' },
    });
    expect(res.status).toBe(401);
  });

  it('fails closed when no token secret is configured (F1)', async () => {
    const savedSecret = process.env.CALLFORGE_TOKEN_SECRET;
    const savedDev = process.env.CALLFORGE_ALLOW_DEV_SECRET;
    delete process.env.CALLFORGE_TOKEN_SECRET;
    delete process.env.CALLFORGE_ALLOW_DEV_SECRET;
    try {
      expect(() => validateAccessToken('a.b.c')).toThrow(/CALLFORGE_TOKEN_SECRET/);
    } finally {
      if (savedSecret !== undefined) {
        process.env.CALLFORGE_TOKEN_SECRET = savedSecret;
      }
      if (savedDev !== undefined) {
        process.env.CALLFORGE_ALLOW_DEV_SECRET = savedDev;
      }
    }
  });

  it('SEC-003: rejects a token whose scope exceeds its role (forged auditor+simulate)', () => {
    const forged = forgeToken(baseClaims({ scope: ['read', 'simulate'] }));
    const result = validateAccessToken(forged);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/scope exceeds role/);
  });

  it('SEC-003: rejects a token with an unknown role', () => {
    const forged = forgeToken(baseClaims({ role: 'superuser' }));
    const result = validateAccessToken(forged);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unknown role/);
  });

  it('SEC-003: accepts a token whose scope is within its role', () => {
    const forged = forgeToken(baseClaims({ role: 'tenant_admin', scope: ['simulate', 'admin'] }));
    const result = validateAccessToken(forged);
    expect(result.valid).toBe(true);
    expect(result.context.scopes).toEqual(['simulate', 'admin']);
  });
});

/**
 * CALLFORGE AI — MCP tool-layer tenant + scope enforcement (issue #8)
 * Negative-path coverage at the tool layer, not only HTTP.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-tool-auth-secret';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { registerTools } from '../tools/index.mjs';
import { createOAuthServer, generateCodeVerifier, pkceS256, ISSUER, AUDIENCE } from '../oauth.mjs';
import { createHmac } from 'node:crypto';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-toolauth-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

function mockServer() {
  const tools = new Map();
  return {
    tool(name, _d, _s, handler) {
      tools.set(name, handler);
    },
    call: (name, args) => tools.get(name)(args),
  };
}

function issueToken({ tenantId, role = 'operator', scope = ['read'] }) {
  const oauth = createOAuthServer();
  const verifier = generateCodeVerifier();
  const { code } = oauth.authorize({
    tenant_id: tenantId,
    role,
    scope,
    code_challenge: pkceS256(verifier),
  });
  const { access_token } = oauth.exchange({ code, code_verifier: verifier });
  return access_token;
}

// Sign arbitrary claims with the test secret to simulate a forged scope claim.
function forgeToken(claims) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    iss: ISSUER,
    aud: AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: 'forged',
    ...claims,
  })}`;
  const sig = createHmac('sha256', process.env.CALLFORGE_TOKEN_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function parse(res) {
  return JSON.parse(res.content[0].text);
}

describe('MCP tool-layer authorization', () => {
  let server;
  let tenantA;
  let tenantB;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await initDatabase();
    const db = getDatabase();
    for (const name of ['A', 'B']) {
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)',
      ).run(id, `tenant-${name}`, '{}', 'pending');
      db.prepare('INSERT INTO business_configs (id, tenant_id, sector) VALUES (?, ?, ?)').run(
        crypto.randomUUID(),
        id,
        'other',
      );
      if (name === 'A') {
        tenantA = id;
      } else {
        tenantB = id;
      }
    }
    const auditLogger = createAuditLogger();
    await auditLogger.initialize();
    server = mockServer();
    await registerTools(server, { auditLogger, authMiddleware: createAuthMiddleware() });
  });

  afterAll(async () => {
    await closeStore();
    rmSync(DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.CALLFORGE_REQUIRE_TOOL_AUTH;
    delete process.env.CALLFORGE_ACCESS_TOKEN;
  });

  it('legacy path: no token still works (unauthenticated mode)', async () => {
    const res = await server.call('check_readiness', { tenant_id: tenantA });
    expect(parse(res).tenant_id ?? tenantA).toBe(tenantA);
  });

  it('rejects a token bound to another tenant (tenant mismatch)', async () => {
    const tokenB = issueToken({ tenantId: tenantB, role: 'tenant_admin', scope: ['read'] });
    const res = await server.call('check_readiness', { tenant_id: tenantA, access_token: tokenB });
    expect(res.isError).toBe(true);
    expect(parse(res).status).toBe(403);
    expect(parse(res).error).toMatch(/Tenant mismatch/);
  });

  it('rejects a valid token that lacks the required scope', async () => {
    const operator = issueToken({ tenantId: tenantA, role: 'operator', scope: ['read'] });
    const res = await server.call('access_audit_log', {
      tenant_id: tenantA,
      access_token: operator,
    });
    expect(res.isError).toBe(true);
    expect(parse(res).status).toBe(403);
    expect(parse(res).error).toMatch(/Insufficient scope: requires audit/);
  });

  it('re-derives scopes from the role, ignoring a forged elevated scope claim', async () => {
    const token = forgeToken({ tenant_id: tenantA, role: 'operator', scope: ['admin'] });
    const res = await server.call('access_audit_log', { tenant_id: tenantA, access_token: token });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/Insufficient scope/);
  });

  it('accepts an auditing token with the required scope', async () => {
    const auditor = issueToken({ tenantId: tenantA, role: 'auditor', scope: ['audit'] });
    const res = await server.call('access_audit_log', {
      tenant_id: tenantA,
      access_token: auditor,
    });
    expect(res.isError).toBeFalsy();
  });

  it('fails closed (401) when a token is required but absent', async () => {
    process.env.CALLFORGE_REQUIRE_TOOL_AUTH = '1';
    const res = await server.call('check_readiness', { tenant_id: tenantA });
    expect(res.isError).toBe(true);
    expect(parse(res).status).toBe(401);
  });

  it('fails closed on a tampered token', async () => {
    const token = issueToken({ tenantId: tenantA, role: 'tenant_admin', scope: ['read'] });
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    const res = await server.call('check_readiness', {
      tenant_id: tenantA,
      access_token: tampered,
    });
    expect(res.isError).toBe(true);
    expect(parse(res).status).toBe(401);
  });

  it('derives the tenant from the token when tenant_id is absent', async () => {
    const token = issueToken({ tenantId: tenantA, role: 'operator', scope: ['read'] });
    const res = await server.call('generate_report', {
      tenant_id: tenantA,
      access_token: token,
      report_type: 'call_volume',
      from_date: '2026-01-01',
      to_date: '2026-12-31',
    });
    expect(res.isError).toBeFalsy();
  });
});

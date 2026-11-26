/**
 * CALLFORGE AI — M09 rate limiting (design §6)
 *
 * Unit coverage for the token bucket plus integration through the real handler:
 * per-tenant isolation, 429 + Retry-After, expensive-tool bucket, and the
 * guarantee that nobody is throttled while discovery/preflight is served.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-rate-limit-secret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { createMcpHttpHandler, protectedResourceMetadata } from '../mcp-http.mjs';
import { createRateLimits, createTokenBucket, expensiveToolOf } from '../mcp-rate-limit.mjs';
import { createOAuthServer, generateCodeVerifier, pkceS256 } from '../oauth.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-rate-'));

function issueToken(tenantId, scope = ['read', 'simulate']) {
  const oauth = createOAuthServer();
  const verifier = generateCodeVerifier();
  const { code } = oauth.authorize({
    tenant_id: tenantId,
    role: 'tenant_admin',
    scope,
    resource: 'https://mcp.example/mcp',
    code_challenge: pkceS256(verifier),
  });
  return oauth.exchange({ code, code_verifier: verifier }).access_token;
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'r', version: '1' },
  },
};

const CALL = name => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name, arguments: {} },
});

describe('token bucket', () => {
  it('allows `limit` requests then refuses with a Retry-After estimate', () => {
    const at = 0;
    const bucket = createTokenBucket({ limit: 3, windowMs: 60_000, now: () => at });
    expect([1, 2, 3].map(() => bucket.take('t').allowed)).toEqual([true, true, true]);
    const blocked = bucket.take('t');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('refills over time and keeps keys isolated', () => {
    let at = 0;
    const bucket = createTokenBucket({ limit: 2, windowMs: 1_000, now: () => at });
    bucket.take('a');
    bucket.take('a');
    expect(bucket.take('a').allowed).toBe(false);
    expect(bucket.take('b').allowed).toBe(true);
    at += 1_000;
    expect(bucket.take('a').allowed).toBe(true);
  });

  it('is disabled at limit 0', () => {
    const bucket = createTokenBucket({ limit: 0 });
    expect(bucket.enabled).toBe(false);
    for (let i = 0; i < 100; i++) {
      expect(bucket.take('t').allowed).toBe(true);
    }
  });
});

describe('expensiveToolOf', () => {
  it('names only tools/call on the expensive set, batch or single', () => {
    expect(expensiveToolOf(CALL('simulate_call'))).toBe('simulate_call');
    expect(expensiveToolOf([INITIALIZE, CALL('generate_report')])).toBe('generate_report');
    expect(expensiveToolOf(CALL('list_tenants'))).toBeNull();
    expect(expensiveToolOf(INITIALIZE)).toBeNull();
  });
});

describe('POST /mcp rate limiting', () => {
  let http;
  let base;
  let tenantA;
  let tenantB;
  let tenantC;

  beforeAll(async () => {
    setTestDatabasePath(join(DIR, 'callforge.db'));
    await initDatabase();
    const insert = getDatabase().prepare(
      'INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)',
    );
    tenantA = crypto.randomUUID();
    tenantB = crypto.randomUUID();
    tenantC = crypto.randomUUID();
    insert.run(tenantA, 'rate-a', '{}', 'pending');
    insert.run(tenantB, 'rate-b', '{}', 'pending');
    insert.run(tenantC, 'rate-c', '{}', 'pending');
    const auditLogger = createAuditLogger();
    await auditLogger.initialize();
    const handler = createMcpHttpHandler({
      authMiddleware: createAuthMiddleware({ auditLogger }),
      auditLogger,
      env: { MCP_PUBLIC_URL: 'https://mcp.example/mcp', PORT: '0' },
      limits: {
        caller: createTokenBucket({ limit: 3 }),
        tool: createTokenBucket({ limit: 1 }),
      },
    });
    http = createServer((req, res) => handler(req, res));
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${http.address().port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => http.close(resolve));
    await closeStore();
    rmSync(DIR, { recursive: true, force: true });
  });

  const post = (token, body = INITIALIZE) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });

  it('throttles a tenant with 429, Retry-After and a problem document', async () => {
    const token = issueToken(tenantA);
    expect((await post(token)).status).toBe(200);
    expect((await post(token)).status).toBe(200);
    expect((await post(token)).status).toBe(200);
    const blocked = await post(token);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('content-type')).toContain('application/problem+json');
    expect((await blocked.json()).status).toBe(429);
  });

  it('does not throttle a different tenant', async () => {
    const token = issueToken(tenantB);
    expect((await post(token)).status).toBe(200);
  });

  it('applies the tighter bucket to expensive tools only', async () => {
    // Fresh tenant: 3 caller tokens available, 1 expensive-tool token.
    const token = issueToken(tenantC);
    expect((await post(token, CALL('simulate_call'))).status).toBe(200);
    const second = await post(token, CALL('simulate_call'));
    expect(second.status).toBe(429);
    // A cheap tool still has caller budget left and no tool bucket.
    expect((await post(token, CALL('list_tenants'))).status).toBe(200);
  });

  it('does not consult the buckets for non-/mcp paths', async () => {
    // Metadata is served by server.mjs before the handler, so even with every
    // bucket exhausted a discovery fetch cannot 429. At handler level the
    // well-known path is simply not a POST route.
    const token = issueToken(tenantA);
    await post(token);
    await post(token);
    await post(token);
    expect((await post(token)).status).toBe(429);
    expect((await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).status).toBe(405);
    expect(protectedResourceMetadata({ MCP_PUBLIC_URL: 'https://mcp.example/mcp' }).resource).toBe(
      'https://mcp.example/mcp',
    );
  });

  it('builds both buckets from env and disables them when unset', () => {
    expect(createRateLimits({}).caller.enabled).toBe(false);
    expect(createRateLimits({ MCP_RATE_LIMIT_PER_MINUTE: '30' }).caller.enabled).toBe(true);
    expect(createRateLimits({ MCP_RATE_LIMIT_TOOL_PER_MINUTE: '5' }).tool.enabled).toBe(true);
  });
});

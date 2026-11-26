/**
 * CALLFORGE AI — M09 Streamable HTTP MCP transport
 *
 * Transport-level conformance: method/version/origin gates, bearer enforcement,
 * RFC9728 metadata, and an end-to-end initialize + tools/call through real HTTP.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-mcp-http-secret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { createMcpHttpHandler, protectedResourceMetadata } from '../mcp-http.mjs';
import { createOAuthServer, generateCodeVerifier, pkceS256 } from '../oauth.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-mcp-http-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

const ORIGIN = 'https://chat.example';

function issueToken(
  tenantId,
  role = 'tenant_admin',
  scope = ['read'],
  resource = 'https://mcp.example/mcp',
) {
  const oauth = createOAuthServer();
  const verifier = generateCodeVerifier();
  const { code } = oauth.authorize({
    tenant_id: tenantId,
    role,
    scope,
    resource,
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
    clientInfo: { name: 'cron-test', version: '1.0.0' },
  },
};

describe('M09 remote MCP transport', () => {
  let http;
  let base;
  let tenantId;
  let token;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await initDatabase();
    tenantId = crypto.randomUUID();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)')
      .run(tenantId, 'http-tenant', '{}', 'pending');
    const auditLogger = createAuditLogger();
    await auditLogger.initialize();
    const handler = createMcpHttpHandler({
      authMiddleware: createAuthMiddleware({ auditLogger }),
      auditLogger,
      env: {
        MCP_ALLOWED_ORIGINS: ORIGIN,
        MCP_PUBLIC_URL: 'https://mcp.example/mcp',
        MCP_MAX_BODY_BYTES: '2048',
        PORT: '0',
      },
    });
    http = createServer((req, res) => handler(req, res));
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${http.address().port}`;
    token = issueToken(tenantId);
  });

  afterAll(async () => {
    await new Promise(resolve => http.close(resolve));
    await closeStore();
    rmSync(DIR, { recursive: true, force: true });
  });

  it('rejects non-POST with 405 and an Allow header', async () => {
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('requires a bearer token with a resource_metadata challenge', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('rejects a disallowed Origin and an unknown protocol version', async () => {
    const badOrigin = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', authorization: `Bearer ${token}` },
      body: '{}',
    });
    expect(badOrigin.status).toBe(403);

    const badVersion = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': '2024-11-05',
      },
      body: '{}',
    });
    expect(badVersion.status).toBe(400);
  });

  it('answers 413 (not a dead socket) for an oversized body', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { origin: ORIGIN, authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...INITIALIZE, pad: 'x'.repeat(4096) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Payload too large' });
  });

  it('completes initialize and tools/call over HTTP with the token tenant', async () => {
    const init = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(init.status).toBe(200);
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe('callforge');

    const call = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'check_readiness', arguments: {} },
      }),
    });
    expect(call.status).toBe(200);
    const payload = JSON.parse((await call.json()).result.content[0].text);
    // No tenant_id sent: the token tenant is the one that got checked.
    expect(payload.checks.tenant_exists).toBe(true);
  });

  it('does not leak another tenant through a foreign token', async () => {
    const other = crypto.randomUUID();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)')
      .run(other, 'other-tenant', '{}', 'pending');
    const foreign = issueToken(other);
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${foreign}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'check_readiness', arguments: { tenant_id: tenantId } },
      }),
    });
    expect(res.status).toBe(200);
    const payload = JSON.parse((await res.json()).result.content[0].text);
    expect(payload.status).toBe(403);
    expect(payload.error).toMatch(/Tenant mismatch/);
  });

  it('serves RFC9728 metadata with the canonical resource', () => {
    const doc = protectedResourceMetadata({ MCP_PUBLIC_URL: 'https://mcp.example/mcp' });
    expect(doc.resource).toBe('https://mcp.example/mcp');
    expect(doc.bearer_methods_supported).toEqual(['header']);
    expect(doc.scopes_supported).toContain('read');
  });
});

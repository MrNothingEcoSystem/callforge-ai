/**
 * CALLFORGE AI — M09 discovery (RFC9728/8414) + resource audience binding (RFC8707)
 *
 * The /mcp surface must advertise absolute discovery documents and only accept
 * tokens minted for the MCP resource itself.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-m09-discovery-secret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { authorizationServerMetadata, protectedResourceMetadata } from '../mcp-http.mjs';
import { createOAuthServer, generateCodeVerifier, normalizeResource, pkceS256 } from '../oauth.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-m09-discovery-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

const PUBLIC_URL = 'https://mcp.example/mcp';
const OTHER_RESOURCE = 'https://other.example/mcp';

function mint(tenantId, { role = 'tenant_admin', scope = ['read'], resource = PUBLIC_URL } = {}) {
  const oauth = createOAuthServer();
  const verifier = generateCodeVerifier();
  const authorized = oauth.authorize({
    tenant_id: tenantId,
    role,
    scope,
    resource,
    code_challenge: pkceS256(verifier),
  });
  return { ...authorized, oauth, verifier };
}

function tokenFor(tenantId, opts) {
  const { oauth, verifier, code } = mint(tenantId, opts);
  return oauth.exchange({ code, code_verifier: verifier }).access_token;
}

function decodeAud(token) {
  const [, body] = token.split('.');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).aud;
}

describe('M09 discovery + audience binding', () => {
  let tenantId;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await initDatabase();
    tenantId = crypto.randomUUID();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)')
      .run(tenantId, 'discovery-tenant', '{}', 'pending');
  });

  afterAll(async () => {
    closeStore();
    rmSync(DIR, { recursive: true, force: true });
  });

  async function withServer(envOverrides, run) {
    const { createMcpHttpHandler } = await import('../mcp-http.mjs');
    const auditLogger = createAuditLogger();
    await auditLogger.initialize();
    const handler = createMcpHttpHandler({
      authMiddleware: createAuthMiddleware({ auditLogger }),
      auditLogger,
      publicUrl: PUBLIC_URL,
      env: { MCP_PUBLIC_URL: PUBLIC_URL, MCP_MAX_BODY_BYTES: '2048', PORT: '0', ...envOverrides },
    });
    const http = createServer((req, res) => handler(req, res));
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${http.address().port}`;
    try {
      return await run(base);
    } finally {
      await new Promise(resolve => http.close(resolve));
    }
  }

  const initializeBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'audience-test', version: '1' },
    },
  });

  function post(base, token) {
    return fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: initializeBody,
    });
  }

  it('protected-resource metadata carries absolute resource + authorization server', () => {
    const md = protectedResourceMetadata({ MCP_PUBLIC_URL: PUBLIC_URL });
    expect(md.resource).toBe(PUBLIC_URL);
    expect(md.authorization_servers[0]).toMatch(/^https:\/\/mcp\.example$/);
    expect(md.bearer_methods_supported).toEqual(['header']);
  });

  it('authorization-server metadata is absolute and advertises resource indicators', () => {
    const md = authorizationServerMetadata({ MCP_PUBLIC_URL: PUBLIC_URL });
    expect(md.issuer).toBe('https://mcp.example');
    expect(md.authorization_endpoint).toBe('https://mcp.example/oauth/authorize');
    expect(md.token_endpoint).toBe('https://mcp.example/oauth/token');
    expect(md.resource_indicators_supported).toBe(true);
    expect(md.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('falls back to the local origin when MCP_PUBLIC_URL is malformed', () => {
    const md = authorizationServerMetadata({ MCP_PUBLIC_URL: 'not a url', PORT: '4444' });
    expect(md.issuer).toBe('http://localhost:4444');
    expect(md.token_endpoint).toBe('http://localhost:4444/oauth/token');
  });

  it('normalizeResource rejects relative and non-http resources and strips fragments', () => {
    expect(normalizeResource('/mcp').error).toMatch(/absolute/);
    expect(normalizeResource('ftp://x.example/mcp').error).toMatch(/http/);
    expect(normalizeResource(`${PUBLIC_URL}#frag`).resource).toBe(PUBLIC_URL);
    expect(normalizeResource(undefined).resource).toBeNull();
  });

  it('mints a resource-bound audience alongside the API audience', () => {
    const token = tokenFor(tenantId);
    expect(decodeAud(token)).toEqual(['callforge-api', PUBLIC_URL]);
  });

  it('accepts a token bound to this resource', async () => {
    await withServer({}, async base => {
      const res = await post(base, tokenFor(tenantId));
      expect(res.status).toBe(200);
    });
  });

  it('rejects a token bound to a different resource with an RFC6750 invalid_token challenge', async () => {
    await withServer({}, async base => {
      const res = await post(base, tokenFor(tenantId, { resource: OTHER_RESOURCE }));
      expect(res.status).toBe(401);
      const challenge = res.headers.get('www-authenticate');
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain(
        'resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"',
      );
    });
  });

  it('rejects a legacy audience token by default but accepts it when binding is off', async () => {
    // null (not undefined) so the default PUBLIC_URL does not apply
    const legacy = tokenFor(tenantId, { resource: null });
    await withServer({}, async base => {
      expect((await post(base, legacy)).status).toBe(401);
    });
    await withServer({ MCP_REQUIRE_RESOURCE_AUDIENCE: '0' }, async base => {
      expect((await post(base, legacy)).status).toBe(200);
    });
  });
});

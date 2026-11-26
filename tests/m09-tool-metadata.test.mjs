/**
 * CALLFORGE AI — M09 remote tool registry (design §4/§5, PR #192 step 4)
 *
 * tools/list over the remote transport must publish the owner-facing subset with
 * explicit annotations and securitySchemes, and no longer advertise
 * `access_token` / `tenant_id`. stdio keeps its legacy schema.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-m09-metadata-secret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { createMcpHttpHandler } from '../mcp-http.mjs';
import { createOAuthServer, generateCodeVerifier, pkceS256 } from '../oauth.mjs';
import { registerTools } from '../tools/index.mjs';
import { REMOTE_TOOL_METADATA } from '../mcp-tool-metadata.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-m09-metadata-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

const ORIGIN = 'https://chat.example';

function issueToken(tenantId, scope = ['read']) {
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

const payloads = token => ({
  origin: ORIGIN,
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
});

async function rpc(base, token, body) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: payloads(token),
    body: JSON.stringify(body),
  });
  const parsed = await res.json();
  return { status: res.status, body: parsed };
}

describe('M09 remote tool registry', () => {
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
      .run(tenantId, 'meta-tenant', '{}', 'pending');
    const auditLogger = createAuditLogger();
    await auditLogger.initialize();
    const handler = createMcpHttpHandler({
      authMiddleware: createAuthMiddleware({ auditLogger }),
      auditLogger,
      env: { MCP_ALLOWED_ORIGINS: ORIGIN, MCP_PUBLIC_URL: 'https://mcp.example/mcp', PORT: '0' },
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

  it('lists the owner-facing subset without create_dev_token', async () => {
    const { status, body } = await rpc(base, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(status).toBe(200);
    const names = body.result.tools.map(t => t.name);
    expect(names).not.toContain('create_dev_token');
    const exposed = Object.entries(REMOTE_TOOL_METADATA)
      .filter(([, meta]) => meta.exposed)
      .map(([name]) => name);
    expect(names.sort()).toEqual(exposed.sort());
  });

  it('publishes annotations and securitySchemes for every listed tool', async () => {
    const { body } = await rpc(base, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    for (const tool of body.result.tools) {
      const expected = REMOTE_TOOL_METADATA[tool.name];
      expect(expected, tool.name).toBeTruthy();
      expect(tool.title).toBe(expected.title);
      expect(tool.annotations).toEqual(expected.annotations);
      expect(tool._meta.securitySchemes).toEqual(expected.securitySchemes);
      // Defaults are worst-case: destructive must always be explicit.
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
    }
    // Read-only tools must not claim destructive/unknown effects.
    const ready = body.result.tools.find(t => t.name === 'check_readiness');
    expect(ready.annotations.readOnlyHint).toBe(true);
    expect(ready.annotations.destructiveHint).toBe(false);
    const onboard = body.result.tools.find(t => t.name === 'onboard_tenant');
    expect(onboard.annotations.readOnlyHint).toBe(false);
    expect(onboard.annotations.idempotentHint).toBe(false);
  });

  it('drops access_token and tenant_id from every advertised schema', async () => {
    const { body } = await rpc(base, token, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
    for (const tool of body.result.tools) {
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain(
        'access_token',
      );
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain('tenant_id');
    }
  });

  it('still calls tools with no credential or tenant in the arguments', async () => {
    const { body } = await rpc(base, token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'check_readiness', arguments: {} },
    });
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.checks.tenant_exists).toBe(true);
  });

  it('keeps the 403 cross-tenant safety net for a stray tenant_id', async () => {
    const other = crypto.randomUUID();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)')
      .run(other, 'other-meta-tenant', '{}', 'pending');
    const { body } = await rpc(base, issueToken(other), {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'check_readiness', arguments: { tenant_id: tenantId } },
    });
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.status).toBe(403);
    expect(payload.error).toMatch(/Tenant mismatch/);
  });

  it('still honours an explicitly passed credential for the onboarding hand-off', async () => {
    // access_token is no longer advertised, but onboarding hands one back; the
    // passthrough schema must let a client use it for the new tenant.
    const admin = issueToken(tenantId, ['admin', 'read']);
    const { body } = await rpc(base, admin, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'onboard_tenant',
        arguments: { name: 'Passthrough Co', admin_email: 'owner@passthrough.example' },
      },
    });
    const onboarded = JSON.parse(body.result.content[0].text);
    expect(onboarded.credential.access_token).toMatch(/^cf_dev_/);

    const followUp = await rpc(base, token, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'check_readiness',
        arguments: { access_token: onboarded.credential.access_token },
      },
    });
    const readiness = JSON.parse(followUp.body.result.content[0].text);
    expect(readiness.checks.tenant_exists).toBe(true);
    expect(readiness.tenant_id).not.toBe(tenantId);
  });

  it('leaves the stdio registry on its legacy schema', async () => {
    const server = new McpServer({ name: 'stdio', version: '0.0.0' });
    const auditLogger = createAuditLogger();
    await registerTools(server, {
      auditLogger,
      authMiddleware: createAuthMiddleware({ auditLogger }),
    });
    const tools = server._registeredTools;
    expect(tools.create_dev_token).toBeTruthy();
    expect(Object.keys(tools.check_readiness.inputSchema.shape).sort()).toEqual([
      'access_token',
      'tenant_id',
    ]);
  });
});

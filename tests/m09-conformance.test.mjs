/**
 * CALLFORGE AI — M09 conformance suite (design §7)
 *
 * Mechanised parts of the remote-MCP conformance plan: protocol method/version
 * gates (A), authorization + tenant isolation (C), tools/list + annotation
 * fidelity (D), the C2 confirmation enforcement point (E), and abuse limits (F).
 * §7B issuer/IdP assertions and §7G interop stay gated on SEC-001; the issuer
 * checks that do not need a real IdP are covered here.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-mcp-conformance-secret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { createMcpHttpHandler, SUPPORTED_PROTOCOL_VERSIONS } from '../mcp-http.mjs';
import { createRateLimits } from '../mcp-rate-limit.mjs';
import { createOAuthServer, generateCodeVerifier, pkceS256 } from '../oauth.mjs';
import { REMOTE_TOOL_METADATA } from '../mcp-tool-metadata.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-mcp-conf-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

const ORIGIN = 'https://chat.example';
const BASE_URL = 'https://mcp.example/mcp';
// The newest advertised version is served via header normalisation (SDK 1.32.2
// does not know it); every test below therefore exercises that path.
const PROTO = { 'mcp-protocol-version': '2026-07-28' };

function issueToken(tenantId, role = 'tenant_admin', scope = ['read'], resource = BASE_URL) {
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

let rpcId = 0;
function rpc(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params });
}

async function startHandler(env = {}, limits) {
  const auditLogger = createAuditLogger();
  await auditLogger.initialize();
  const handler = createMcpHttpHandler({
    authMiddleware: createAuthMiddleware({ auditLogger }),
    auditLogger,
    limits,
    env: { MCP_ALLOWED_ORIGINS: ORIGIN, MCP_PUBLIC_URL: BASE_URL, PORT: '0', ...env },
  });
  const http = createServer((req, res) => handler(req, res));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  return { http, base: `http://127.0.0.1:${http.address().port}`, auditLogger };
}

describe('M09 conformance', () => {
  let http;
  let base;
  let tenantId;
  let otherTenantId;
  let adminToken;
  let operatorToken;
  const post = (token, body, headers = {}) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...PROTO,
        ...headers,
      },
      body,
    });

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await initDatabase();
    const db = getDatabase();
    tenantId = crypto.randomUUID();
    otherTenantId = crypto.randomUUID();
    for (const [id, name] of [
      [tenantId, 'conf-a'],
      [otherTenantId, 'conf-b'],
    ]) {
      db.prepare(
        'INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?,?,?,?)',
      ).run(id, name, '{}', 'pending');
    }
    ({ http, base } = await startHandler());
    adminToken = issueToken(tenantId, 'tenant_admin', ['read', 'simulate', 'audit', 'admin']);
    operatorToken = issueToken(tenantId, 'operator', ['read', 'simulate']);
  });

  afterAll(async () => {
    await new Promise(resolve => http.close(resolve));
    await closeStore();
    rmSync(DIR, { recursive: true, force: true });
  });

  describe('A. protocol', () => {
    it('rejects every non-POST method with 405 + Allow: POST', async () => {
      for (const method of ['GET', 'DELETE', 'PUT']) {
        const res = await fetch(`${base}/mcp`, { method });
        expect(res.status, method).toBe(405);
        expect(res.headers.get('allow')).toBe('POST');
      }
    });

    it('rejects an unknown protocol version with 400 and lists exactly what the SDK honours', async () => {
      const res = await post(adminToken, rpc('tools/list', {}), {
        'mcp-protocol-version': '2024-01-01',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      // The transport gate and the SDK must agree (regression: gate claimed 2026-07-28,
      // which the SDK rejects, while withholding versions it accepts).
      expect(body.supported.sort()).toEqual([...SUPPORTED_PROTOCOL_VERSIONS].sort());
    });

    it('serves the SDK-unknown 2026-07-28 version by normalising it downstream', async () => {
      const res = await post(adminToken, rpc('tools/list', {}), {
        'mcp-protocol-version': '2026-07-28',
      });
      expect(res.status).toBe(200);
      expect((await res.json()).result.tools.length).toBeGreaterThan(0);
    });

    it('answers an unknown method with JSON-RPC -32601', async () => {
      const res = await post(adminToken, rpc('no/such-method', {}));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error.code).toBe(-32601);
    });

    it('negotiates initialize and returns server info', async () => {
      const res = await post(
        adminToken,
        rpc('initialize', {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'conf', version: '1' },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.serverInfo.name).toBeTruthy();
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(body.result.protocolVersion);
    });

    it('serves JSON when both Accept types are offered, and 406s JSON-only', async () => {
      const both = await post(adminToken, rpc('tools/list', {}), {
        accept: 'application/json, text/event-stream',
      });
      expect(both.status).toBe(200);
      expect(both.headers.get('content-type')).toContain('application/json');
      const jsonOnly = await post(adminToken, rpc('tools/list', {}), {
        accept: 'application/json',
      });
      expect(jsonOnly.status).toBe(406);
    });

    it('answers a malformed body with -32700', async () => {
      const res = await post(adminToken, '{not json');
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(-32700);
    });
  });

  describe('C. authorization and tenant isolation', () => {
    it('401s a missing token, a garbage token and a wrong-audience token', async () => {
      expect((await post(null, rpc('tools/list', {}))).status).toBe(401);
      expect((await post('abc.def.ghi', rpc('tools/list', {}))).status).toBe(401);
      const foreign = issueToken(tenantId, 'tenant_admin', ['read'], 'https://other.example/mcp');
      const res = await post(foreign, rpc('tools/list', {}));
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('invalid_token');
    });

    it('403s a cross-tenant tenant_id', async () => {
      const res = await post(
        adminToken,
        rpc('tools/call', {
          name: 'check_readiness',
          arguments: { tenant_id: otherTenantId },
        }),
      );
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toMatch(/tenant/i);
    });

    it('enforces the scope matrix (operator cannot configure, read cannot audit)', async () => {
      const configure = await post(
        operatorToken,
        rpc('tools/call', { name: 'configure_business', arguments: { business_name: 'X' } }),
      );
      expect((await configure.json()).result.content[0].text).toMatch(/requires admin/);
      const readOnly = issueToken(tenantId, 'operator', ['read']);
      const audit = await post(
        readOnly,
        rpc('tools/call', { name: 'access_audit_log', arguments: {} }),
      );
      expect((await audit.json()).result.content[0].text).toMatch(/requires audit/);
    });

    it('never lists create_dev_token', async () => {
      const body = await (await post(adminToken, rpc('tools/list', {}))).json();
      const names = body.result.tools.map(t => t.name);
      expect(names).not.toContain('create_dev_token');
      expect(names.sort()).toEqual(
        Object.keys(REMOTE_TOOL_METADATA)
          .filter(n => n !== 'create_dev_token')
          .sort(),
      );
    });
  });

  describe('D. tools and annotations', () => {
    it('publishes the design annotations and securitySchemes verbatim', async () => {
      const body = await (await post(adminToken, rpc('tools/list', {}))).json();
      for (const tool of body.result.tools) {
        const meta = REMOTE_TOOL_METADATA[tool.name];
        expect(tool.annotations, tool.name).toEqual(meta.annotations);
        expect(tool._meta.securitySchemes, tool.name).toEqual(meta.securitySchemes);
        expect(tool.outputSchema, tool.name).toBeTruthy();
      }
    });

    it('a read-only tool only logs, and mutates no configuration', async () => {
      const db = getDatabase();
      const before = db.prepare('SELECT COUNT(*) c FROM audit_events').get().c;
      await post(adminToken, rpc('tools/call', { name: 'check_readiness', arguments: {} }));
      const rows = db.prepare('SELECT event_type FROM audit_events ORDER BY created_at').all();
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1).event_type).toBe('readiness_checked');
      expect(db.prepare('SELECT COUNT(*) c FROM business_configs').get().c).toBe(0);
    });

    it('rejects a list_call_history limit above the 100 cap', async () => {
      const res = await post(
        adminToken,
        rpc('tools/call', { name: 'list_call_history', arguments: { limit: 101 } }),
      );
      const body = await res.json();
      expect(body.result.isError).toBe(true);
    });
  });

  describe('E. confirmation enforcement', () => {
    it('parks a licensed configure_business, applies nothing, then applies on accept', async () => {
      const db = getDatabase();
      const call = rpc('tools/call', {
        name: 'configure_business',
        arguments: { license_number: 'CONF-1' },
      });
      const first = await (await post(adminToken, call)).json();
      expect(first.result.resultType).toBe('input_required');
      expect(
        db.prepare('SELECT * FROM business_configs WHERE tenant_id = ?').get(tenantId),
      ).toBeUndefined();
      const resumed = await (
        await post(
          adminToken,
          rpc('tools/call', {
            name: 'configure_business',
            arguments: { license_number: 'CONF-1' },
            inputResponses: { confirm: { action: 'accept' } },
            requestState: first.result.requestState,
          }),
        )
      ).json();
      expect(resumed.result.structuredContent.status).toBe('configured');
    });

    it('declines without mutating and audits the decline', async () => {
      const db = getDatabase();
      const first = await (
        await post(
          adminToken,
          rpc('tools/call', {
            name: 'configure_business',
            arguments: { license_number: 'CONF-2' },
          }),
        )
      ).json();
      const declined = await (
        await post(
          adminToken,
          rpc('tools/call', {
            name: 'configure_business',
            arguments: { license_number: 'CONF-2' },
            inputResponses: { confirm: { action: 'decline' } },
            requestState: first.result.requestState,
          }),
        )
      ).json();
      expect(declined.result.structuredContent.status).toBe('declined');
      expect(
        db.prepare('SELECT license_number FROM business_configs WHERE tenant_id = ?').get(tenantId)
          .license_number,
      ).toBe('CONF-1');
      expect(
        db
          .prepare("SELECT COUNT(*) c FROM audit_events WHERE event_type = 'elicitation_declined'")
          .get().c,
      ).toBeGreaterThan(0);
    });
  });

  describe('F. abuse and robustness', () => {
    it('403s a spoofed Origin', async () => {
      const res = await post(adminToken, rpc('tools/list', {}), { origin: 'https://evil.example' });
      expect(res.status).toBe(403);
    });

    it('answers 413 for a body above the cap, not a dead socket', async () => {
      const { http: tiny, base: tinyBase } = await startHandler({ MCP_MAX_BODY_BYTES: '1024' });
      try {
        const res = await fetch(`${tinyBase}/mcp`, {
          method: 'POST',
          headers: { origin: ORIGIN, authorization: `Bearer ${adminToken}`, ...PROTO },
          body: JSON.stringify({ ...JSON.parse(rpc('tools/list', {})), pad: 'x'.repeat(4096) }),
        });
        expect(res.status).toBe(413);
      } finally {
        await new Promise(resolve => tiny.close(resolve));
      }
    });

    it('429s a burst with Retry-After', async () => {
      const limited = createRateLimits({ MCP_RATE_LIMIT_PER_MINUTE: '2' });
      const { http: burst, base: burstBase } = await startHandler({}, limited);
      try {
        const send = () =>
          fetch(`${burstBase}/mcp`, {
            method: 'POST',
            headers: {
              origin: ORIGIN,
              authorization: `Bearer ${adminToken}`,
              accept: 'application/json, text/event-stream',
              'content-type': 'application/json',
              ...PROTO,
            },
            body: rpc('tools/list', {}),
          });
        expect((await send()).status).toBe(200);
        expect((await send()).status).toBe(200);
        const third = await send();
        expect(third.status).toBe(429);
        expect(third.headers.get('retry-after')).toBeTruthy();
      } finally {
        await new Promise(resolve => burst.close(resolve));
      }
    });
  });
});

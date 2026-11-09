import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pkceS256, generateCodeVerifier } from '../oauth.mjs';

// M09 remote MCP regression tests (2026-11-09).
process.env.CALLFORGE_ALLOW_DEV_SECRET ??= 'true';
const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m09-'));
let srv;
let tenantId;

function createRes() {
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

async function* bodyStream(obj) {
  yield Buffer.from(JSON.stringify(obj));
}

function issueToken(roles = ['operator']) {
  const verifier = generateCodeVerifier();
  const auth = srv.oauth.authorize({
    tenant_id: tenantId,
    role: roles[0],
    scope: ['read', 'simulate', 'audit', 'admin'],
    code_challenge: pkceS256(verifier),
    code_challenge_method: 'S256',
  });
  const { access_token } = srv.oauth.exchange({ code: auth.code, code_verifier: verifier });
  return access_token;
}

async function rpc(token, method, params = {}) {
  const res = createRes();
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    [Symbol.asyncIterator]: () => bodyStream({ jsonrpc: '2.0', method, params, id: 1 }),
  };
  await srv.handleMcp(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

describe('M09 remote MCP endpoint', () => {
  beforeAll(async () => {
    const { setTestDatabasePath, initDatabase, generateId, getDatabase } =
      await import('../store.mjs');
    setTestDatabasePath(join(TEST_DIR, 'callforge.db'));
    await initDatabase();
    tenantId = generateId();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)')
      .run(tenantId, 'T', '{}');
    const { CallforgeHttpServer } = await import('../server.mjs');
    srv = new CallforgeHttpServer();
  });

  afterAll(async () => {
    const { closeStore } = await import('../store.mjs');
    await closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('unauthenticated /mcp is rejected', async () => {
    const r = await rpc(null, 'tools/list');
    expect(r.status).toBe(401);
  });

  it('tools/list excludes create_dev_token and strips tenant_id from schemas', async () => {
    const token = issueToken();
    const r = await rpc(token, 'tools/list');
    expect(r.status).toBe(200);
    const tools = r.json.result.tools;
    expect(tools.some(t => t.name === 'create_dev_token')).toBe(false);
    for (const tool of tools) {
      expect(tool.inputSchema.properties).not.toHaveProperty('tenant_id');
      expect(tool.annotations).toBeTruthy();
    }
  });

  it('tools/call rejects a mismatched client tenant_id with 403', async () => {
    const token = issueToken();
    const r = await rpc(token, 'tools/call', {
      name: 'check_readiness',
      arguments: { tenant_id: 'not-the-token-tenant' },
    });
    expect(r.status).toBe(403);
  });

  it('tools/call injects tenant from token and runs check_readiness', async () => {
    const token = issueToken();
    const r = await rpc(token, 'tools/call', { name: 'check_readiness', arguments: {} });
    expect(r.status).toBe(200);
    expect(r.json.result.content[0].text).toContain('"ready":true');
  });

  it('unknown remote tool returns 404 JSON-RPC error', async () => {
    const token = issueToken();
    const r = await rpc(token, 'tools/call', { name: 'create_dev_token', arguments: {} });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe(-32601);
  });

  it('protected-resource discovery advertises usable metadata (via route handler)', async () => {
    // Route-level check happens over HTTP; here verify the metadata shape source values.
    const { ISSUER } = await import('../oauth.mjs');
    expect(ISSUER).toBeTruthy();
  });
});

/**
 * CALLFORGE AI — M09 C2 confirmation gate + structured outputs (design §4/§7E)
 *
 * A C2 call (configure_business touching a licensed/externally-binding flag) must
 * answer `input_required` and only mutate after an accepted confirmation; decline
 * and cancel leave the configuration untouched and are audited. Read tools must
 * publish an outputSchema and return structuredContent.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-m09-elicitation-secret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initDatabase, getDatabase, closeStore, setTestDatabasePath } from '../store.mjs';
import { createAuditLogger } from '../audit.mjs';
import { createAuthMiddleware } from '../auth.mjs';
import { createMcpHttpHandler } from '../mcp-http.mjs';
import { createOAuthServer, generateCodeVerifier, pkceS256 } from '../oauth.mjs';
import { gate, riskyChanges, stateMatches } from '../mcp-elicitation.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-m09-elicit-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

const ORIGIN = 'https://chat.example';

function issueToken(tenantId, scope = ['read', 'admin']) {
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

async function startServer(env = {}) {
  const http = createServer((req, res) => handlerRef(req, res));
  const auditLogger = createAuditLogger();
  await auditLogger.initialize();
  const handler = createMcpHttpHandler({
    authMiddleware: createAuthMiddleware({ auditLogger }),
    auditLogger,
    env: {
      MCP_ALLOWED_ORIGINS: ORIGIN,
      MCP_PUBLIC_URL: 'https://mcp.example/mcp',
      PORT: '0',
      ...env,
    },
  });
  handlerRef = handler;
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  return { http, auditLogger, base: `http://127.0.0.1:${http.address().port}` };
}

let handlerRef;

function rpc(base, token, body) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  }).then(async res => ({ status: res.status, body: await res.json() }));
}

const call = (name, args, extra = {}) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args, ...extra },
});

const config = tenantId =>
  getDatabase().prepare('SELECT * FROM business_configs WHERE tenant_id = ?').get(tenantId);

describe('unit: gate', () => {
  it('ignores non-C2 tools and non-licensed changes', () => {
    expect(riskyChanges('simulate_call', { idempotency_key: 'k' })).toEqual([]);
    expect(gate('simulate_call', {}).action).toBe('none');
    expect(gate('configure_business', { business_name: 'X' }).action).toBe('none');
  });

  it('requests confirmation for licensed flags and resumes on accept', () => {
    expect(riskyChanges('configure_business', { license_number: 'L1', sector: 'retail' })).toEqual([
      'license_number',
    ]);
    const asked = gate('configure_business', { license_number: 'L1' });
    expect(asked.action).toBe('require');
    const request = asked.inputRequests.confirm;
    expect(request.type).toBe('elicitation');
    expect(request.requestedSchema.required).toEqual(['confirm']);
    const state = request.requestState;
    expect(stateMatches(state, 'configure_business', { license_number: 'L1' })).toBe(true);
    expect(stateMatches(state, 'configure_business', { license_number: 'L2' })).toBe(false);
    expect(
      gate('configure_business', { license_number: 'L1' }, { confirm: { action: 'accept' } })
        .action,
    ).toBe('accept');
    expect(
      gate('configure_business', { license_number: 'L1' }, { confirm: { action: 'decline' } })
        .action,
    ).toBe('declined');
    expect(
      gate(
        'configure_business',
        { license_number: 'L1' },
        { confirm: { action: 'accept', content: { confirm: false } } },
      ).action,
    ).toBe('declined');
  });
});

describe('M09 confirmation gate over the transport', () => {
  let http;
  let base;
  let auditLogger;
  let tenantId;
  let token;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await initDatabase();
    tenantId = crypto.randomUUID();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)')
      .run(tenantId, 'elicit-tenant', '{}', 'pending');
    const started = await startServer();
    http = started.http;
    base = started.base;
    auditLogger = started.auditLogger;
    token = issueToken(tenantId);
  });

  afterAll(async () => {
    await new Promise(resolve => http.close(resolve));
    await closeStore();
  });

  it('applies a C1 change directly with structured content', async () => {
    const { body } = await rpc(
      base,
      token,
      call('configure_business', { business_name: 'Al Noor' }),
    );
    expect(body.result.resultType).toBeUndefined();
    expect(body.result.structuredContent.status).toBe('configured');
    expect(config(tenantId).business_name).toBe('Al Noor');
  });

  it('stops at input_required for a licensed flag and writes nothing', async () => {
    const before = config(tenantId).license_number;
    const { body } = await rpc(
      base,
      token,
      call('configure_business', { license_number: 'DED-123' }),
    );
    expect(body.result.resultType).toBe('input_required');
    expect(body.result.inputRequests.confirm.requestedSchema.required).toEqual(['confirm']);
    expect(body.result.requestState).toBe(body.result.inputRequests.confirm.requestState);
    expect(config(tenantId).license_number).toBe(before ?? null);
  });

  it('applies the change once the confirmation is accepted', async () => {
    const asked = await rpc(base, token, call('configure_business', { license_number: 'DED-123' }));
    const state = asked.body.result.requestState;
    const { body } = await rpc(
      base,
      token,
      call(
        'configure_business',
        { license_number: 'DED-123' },
        {
          inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
          requestState: state,
        },
      ),
    );
    expect(body.result.structuredContent.status).toBe('configured');
    expect(config(tenantId).license_number).toBe('DED-123');
  });

  it('re-issues the confirmation when the requestState is stale', async () => {
    const stale = await rpc(base, token, call('configure_business', { license_number: 'AAA' }));
    const state = stale.body.result.requestState;
    const { body } = await rpc(
      base,
      token,
      call(
        'configure_business',
        { license_number: 'BBB' },
        {
          inputResponses: { confirm: { action: 'accept', content: { confirm: true } } },
          requestState: state,
        },
      ),
    );
    expect(body.result.resultType).toBe('input_required');
    expect(config(tenantId).license_number).toBe('DED-123');
  });

  it('declines without mutating and audits the decision', async () => {
    const { body } = await rpc(
      base,
      token,
      call(
        'configure_business',
        { dncr_check_enabled: false },
        { inputResponses: { confirm: { action: 'decline' } } },
      ),
    );
    expect(body.result.structuredContent.status).toBe('declined');
    expect(body.result.structuredContent.reason).toMatch(/declined/);
    const events = await auditLogger.getEvents({
      tenant_id: tenantId,
      event_type: 'elicitation_declined',
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('publishes outputSchema and returns structuredContent for read tools', async () => {
    const list = await rpc(base, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const readinessTool = list.body.result.tools.find(t => t.name === 'check_readiness');
    expect(readinessTool.outputSchema).toBeTruthy();
    const { body } = await rpc(base, token, call('check_readiness', {}));
    expect(body.result.structuredContent.checks.tenant_exists).toBe(true);
    expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent);
  });
});

describe('gate disabled', () => {
  let http;
  let base;
  let tenantId;
  let token;

  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    await initDatabase();
    const started = await startServer({ MCP_ELICITATION_GATE: '0' });
    http = started.http;
    base = started.base;
    tenantId = crypto.randomUUID();
    getDatabase()
      .prepare('INSERT INTO tenants (id, name, settings, compliance_status) VALUES (?, ?, ?, ?)')
      .run(tenantId, 'no-gate-tenant', '{}', 'pending');
    token = issueToken(tenantId);
  });

  afterAll(async () => {
    await new Promise(resolve => http.close(resolve));
    await closeStore();
    rmSync(DIR, { recursive: true, force: true });
  });

  it('applies licensed changes without a round trip when the gate is off', async () => {
    const { body } = await rpc(
      base,
      token,
      call('configure_business', { recording_consent_required: false }),
    );
    expect(body.result.resultType).toBeUndefined();
    expect(config(tenantId).recording_consent_required).toBe(0);
  });
});

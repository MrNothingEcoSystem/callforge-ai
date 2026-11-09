/**
 * CALLFORGE AI — HTTP Server (Simulation Mode)
 * v0.2 Simulation Baseline
 *
 * Provides REST endpoints for simulation, health checks,
 * and webhook handling (disabled in v0.2).
 */

import { createServer } from 'http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parse } from 'url';
import { initDatabase, getDatabase, closeStore } from './store.mjs';
import { createAuditLogger } from './audit.mjs';
import { createOAuthServer, ISSUER, AUDIENCE } from './oauth.mjs';
import { createMcpHandler } from './mcp.mjs';
import { receiveWebhook } from './workflow/webhookInbox.mjs';
import { runRecovery } from './workflow/recovery.mjs';
import { createDispatcher } from './workflow/dispatcher.mjs';

const PORT = process.env.PORT || 3000;
const SIMULATION_MODE = process.env.SIMULATION_MODE !== 'false'; // Default true for v0.2

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

class CallforgeHttpServer {
  constructor() {
    this.server = null;
    this.auditLogger = null;
    this.oauth = createOAuthServer();
    this.recoveryDone = false;
    this.dispatcher = null;
  }

  async initialize() {
    await initDatabase();
    // M03-2: crash recovery before /ready is reported healthy.
    const recovery = runRecovery(getDatabase());
    this.recoveryDone = true;
    this.dispatcher = createDispatcher(getDatabase());
    this.dispatcher.start();
    this.auditLogger = createAuditLogger();
    await this.auditLogger.initialize();

    await this.auditLogger.log({
      event_type: 'http_server_initialized',
      actor_type: 'system',
      action: 'initialize_http_server',
      payload: { simulation_mode: SIMULATION_MODE, port: PORT, recovery },
    });
  }

  start() {
    this.server = createServer(async (req, res) => {
      const parsedUrl = parse(req.url, true);
      const path = parsedUrl.pathname;
      const method = req.method;

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        await this.routeRequest(req, res, path, method, parsedUrl.query);
      } catch (error) {
        console.error('Request error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.server.listen(PORT, () => {
      console.log(
        `CALLFORGE HTTP server listening on port ${PORT} (simulation: ${SIMULATION_MODE})`,
      );
    });
  }

  async routeRequest(req, res, path, method, query) {
    // Health check
    if (path === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'callforge',
          version: '0.2.0',
          simulation_mode: SIMULATION_MODE,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // Readiness check — 503 until M03-2 crash recovery has completed.
    if (path === '/ready' && method === 'GET') {
      const db = this.recoveryDone ? getDatabase() : null;
      const result = db ? db.prepare('SELECT 1').get() : null;
      res.writeHead(result ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ready: !!result,
          database: !!result,
          recovery: this.recoveryDone,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // OAuth 2.1 endpoints (M02): authorize + token + discovery
    if (path === '/oauth/authorize' && method === 'POST') {
      await this.handleOAuthAuthorize(req, res);
      return;
    }
    if (path === '/oauth/token' && method === 'POST') {
      await this.handleOAuthToken(req, res);
      return;
    }
    if (path === '/.well-known/oauth-authorization-server' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: ISSUER,
          audience: AUDIENCE,
          authorization_endpoint: '/oauth/authorize',
          token_endpoint: '/oauth/token',
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code'],
        }),
      );
      return;
    }

    // M09: RFC9728 protected-resource discovery for the /mcp endpoint.
    if (path === '/.well-known/oauth-protected-resource' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          resource: `${ISSUER}/mcp`,
          authorization_servers: [ISSUER],
          scopes_supported: ['read', 'simulate', 'audit', 'admin'],
          bearer_methods_supported: ['header'],
        }),
      );
      return;
    }

    // M09: remote MCP endpoint (simulation-first; tenant from token only).
    if (path === '/mcp' && method === 'POST') {
      await this.handleMcp(req, res);
      return;
    }

    // Simulation endpoints (v0.2 only) — M02: authenticated + scoped
    if (SIMULATION_MODE) {
      if (path === '/simulate/call' && method === 'POST') {
        await this.handleSimulateCall(req, res);
        return;
      }
      if (path === '/simulate/conversation' && method === 'POST') {
        await this.handleSimulateConversation(req, res);
        return;
      }
      if (path === '/simulate/status' && method === 'GET') {
        await this.handleSimulateStatus(req, res, query);
        return;
      }
    }

    // Webhook endpoints (M03-2): HMAC-verified store; 202 stored, 200 duplicate, 401 on bad signature (nothing stored)
    if (path.startsWith('/webhook/')) {
      await this.handleWebhook(req, res, path.slice('/webhook/'.length));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /** M09: remote MCP (simulation-first). Tools run through the registry. */
  async handleMcp(req, res) {
    const handler = createMcpHandler({
      guard: (rq, rs, scopes) => this.guard(rq, rs, scopes),
      callTool: async (name, args, context) => {
        // Simulation-first: only path that never has external side effects.
        // M09: the remote tool registry dispatches through this table.
        if (name === 'check_readiness') {
          const db = getDatabase();
          const row = db.prepare('SELECT 1').get();
          return { content: [{ type: 'text', text: JSON.stringify({ ready: !!row }) }] };
        }
        if (name === 'get_call_status') {
          const db = getDatabase();
          const intent = db
            .prepare('SELECT * FROM call_intents WHERE id = ? AND tenant_id = ?')
            .get(args.call_intent_id, context.tenantId);
          return {
            content: [{ type: 'text', text: JSON.stringify(intent ?? { error: 'not found' }) }],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ simulated: true, tool: name }) }],
        };
      },
    });
    await handler.handle(req, res);
  }

  /** M03-2: HMAC-verified webhook store. 401 + nothing stored on failure. */
  async handleWebhook(req, res, provider) {
    // F5: single-segment provider identifiers only.
    if (!/^[a-z0-9._-]{1,64}$/i.test(provider || '')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid provider identifier' }));
      return;
    }
    // F4: bounded body — enforced before buffering, so oversize payloads
    // are rejected without ever reading the full stream into memory.
    const maxBytes = Number(process.env.MAX_WEBHOOK_BODY_BYTES || 1048576);
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) {
        req.destroy?.();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook payload too large', max_bytes: maxBytes }));
        return;
      }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString();
    const secret = process.env.WEBHOOK_SECRET || '';
    const signature = req.headers['x-signature'] || '';
    if (!secret) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook receiver not configured' }));
      return;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid webhook signature' }));
      return;
    }
    const dedupKey = req.headers['x-dedup-key'] || undefined;
    const result = receiveWebhook(getDatabase(), {
      provider: provider || 'unknown',
      dedupKey,
      rawBody,
      signature,
    });
    res.writeHead(result.stored ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stored: result.stored, id: result.row.id }));
  }

  /** M02: authenticate + scope-check. Returns context or sends error response. */
  guard(req, res, requiredScopes) {
    const auth = this.oauth.authenticate(req);
    if (!auth.valid) {
      res.writeHead(auth.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: auth.error }));
      return null;
    }
    const check = this.oauth.authorizeScopes(auth.context, requiredScopes);
    if (!check.authorized) {
      res.writeHead(check.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: check.error }));
      return null;
    }
    return auth.context;
  }

  /** M02: a client-supplied tenant_id must never widen the token tenant. */
  rejectTenantMismatch(res, claimedTenantId, context) {
    if (claimedTenantId && claimedTenantId !== context.tenantId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'Tenant mismatch: token tenant does not match request tenant' }),
      );
      return true;
    }
    return false;
  }

  async handleOAuthAuthorize(req, res) {
    const body = await readJsonBody(req);
    const result = this.oauth.authorize(body);
    if (result.error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    await this.auditLogger.log({
      tenant_id: body.tenant_id,
      event_type: 'oauth_authorize',
      actor_type: 'system',
      action: 'authorize',
      payload: { client_id: body.client_id || 'callforge-sim', role: body.role || 'operator' },
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async handleOAuthToken(req, res) {
    const body = await readJsonBody(req);
    const result = this.oauth.exchange(body);
    if (result.error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async handleSimulateCall(req, res) {
    const context = this.guard(req, res, ['simulate']);
    if (!context) {
      return;
    }
    const tenant_id = context.tenantId;
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const {
      tenant_id: claimed_tenant_id,
      idempotency_key,
      direction,
      from_number,
      to_number,
      language,
      voice_config,
      business_context,
    } = JSON.parse(body || '{}');

    if (this.rejectTenantMismatch(res, claimed_tenant_id, context)) {
      return;
    }
    if (!idempotency_key || !direction) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: idempotency_key, direction' }));
      return;
    }

    const db = getDatabase();

    // Check idempotency
    const existing = db
      .prepare('SELECT * FROM call_intents WHERE tenant_id = ? AND idempotency_key = ?')
      .get(tenant_id, idempotency_key);
    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          call_intent_id: existing.id,
          status: existing.status,
          idempotent: true,
          message: 'Call intent already exists (idempotent)',
        }),
      );
      return;
    }

    // Create call intent
    const callIntentId = crypto.randomUUID();

    db.prepare(
      `
      INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, from_number, to_number, language, voice_config, business_context, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `,
    ).run(
      callIntentId,
      tenant_id,
      idempotency_key,
      direction,
      from_number || null,
      to_number || null,
      language || 'en',
      JSON.stringify(voice_config || {}),
      JSON.stringify(business_context || {}),
    );

    // Log audit event
    await this.auditLogger.log({
      tenant_id,
      event_type: 'call_intent_created',
      actor_type: 'system',
      action: 'simulate_call',
      resource_type: 'call_intent',
      resource_id: callIntentId,
      payload: { direction, language, idempotency_key },
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        call_intent_id: callIntentId,
        status: 'pending',
        idempotent: false,
        message: 'Call intent created (simulation mode)',
      }),
    );
  }

  async handleSimulateConversation(req, res) {
    const context = this.guard(req, res, ['read']);
    if (!context) {
      return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const { language, scenario } = JSON.parse(body || '{}');

    if (!language || !scenario) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required fields: language, scenario' }));
      return;
    }

    // Conversation fixtures are intentionally global seeded data (no tenant
    // column in conversation_fixtures); the endpoint is still authenticated
    // + scope-checked above. Tenant-scoped fixtures require a schema change
    // and must not be added without tenant filtering (M02 audit F4).
    const db = getDatabase();
    const fixture = db
      .prepare('SELECT * FROM conversation_fixtures WHERE language = ? AND scenario = ?')
      .get(language, scenario);

    if (!fixture) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No fixture found for ${language}/${scenario}` }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        language: fixture.language,
        scenario: fixture.scenario,
        turns: JSON.parse(fixture.turns),
        expected_outcome: fixture.expected_outcome,
      }),
    );
  }

  async handleSimulateStatus(req, res, query) {
    const context = this.guard(req, res, ['read']);
    if (!context) {
      return;
    }
    const tenant_id = context.tenantId;
    const { tenant_id: claimed_tenant_id, call_intent_id } = query;

    if (this.rejectTenantMismatch(res, claimed_tenant_id, context)) {
      return;
    }
    if (!call_intent_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing call_intent_id query parameter' }));
      return;
    }

    const db = getDatabase();
    const intent = db
      .prepare('SELECT * FROM call_intents WHERE id = ? AND tenant_id = ?')
      .get(call_intent_id, tenant_id);

    if (!intent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Call intent not found' }));
      return;
    }

    const events = db
      .prepare('SELECT * FROM call_events WHERE call_intent_id = ? ORDER BY sequence_number')
      .all(call_intent_id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        call_intent: {
          id: intent.id,
          tenant_id: intent.tenant_id,
          direction: intent.direction,
          from_number: intent.from_number,
          to_number: intent.to_number,
          status: intent.status,
          language: intent.language,
          created_at: intent.created_at,
          dispatched_at: intent.dispatched_at,
          completed_at: intent.completed_at,
        },
        events: events.map(e => ({
          id: e.id,
          event_type: e.event_type,
          payload: JSON.parse(e.payload),
          provider_event_id: e.provider_event_id,
          provider_name: e.provider_name,
          sequence_number: e.sequence_number,
          created_at: e.created_at,
        })),
      }),
    );
  }

  async shutdown() {
    if (this.server) {
      await new Promise(resolve => this.server.close(() => resolve(undefined)));
    }
    await closeStore();
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new CallforgeHttpServer();
  await server.initialize();
  server.start();

  process.on('SIGINT', async () => {
    await server.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
  });
}

export { CallforgeHttpServer };

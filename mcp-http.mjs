/**
 * CALLFORGE AI — M09 remote MCP transport (Streamable HTTP, opt-in)
 *
 * Serves the existing 11 tools over POST /mcp for remote MCP clients while
 * stdio stays the local default. Design: management/M09_REMOTE_MCP_DESIGN.md.
 *
 * Posture (deliberately strict; the endpoint is the public surface):
 *  - Bearer token required (JWT access token or a dev token from the api_keys
 *    store), verified before a single byte of JSON-RPC is dispatched.
 *  - 401 carries `WWW-Authenticate: Bearer resource_metadata="..."` (RFC9728).
 *  - Stateless: a fresh McpServer per request, no session id, no GET/SSE stream;
 *    GET/DELETE answer 405 with `Allow: POST`.
 *  - Origin allow-list, protocol-version header validation, body-size cap.
 *
 * Nothing here activates live calls or spends money; it is a transport only.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools/index.mjs';
import { AUDIENCE, ISSUER, validateAccessToken } from './oauth.mjs';
import { createRateLimits, expensiveToolOf } from './mcp-rate-limit.mjs';
import { gate, declinedResult, stateMatches } from './mcp-elicitation.mjs';

export { createRateLimits };

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-11-25', '2026-07-28'];
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

export function parseOrigins(value) {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function sendTooManyRequests(res, retryAfter, limit) {
  res.writeHead(429, {
    'Content-Type': 'application/problem+json',
    'Retry-After': String(retryAfter),
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': '0',
  });
  res.end(
    JSON.stringify({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: `Rate limit exceeded; retry in ${retryAfter}s`,
    }),
  );
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        // Keep the socket: drain the remainder so the 413 actually reaches the
        // client instead of dying with an RST on req.destroy().
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof import('./auth.mjs').createAuthMiddleware>} [opts.authMiddleware] dev-token validator
 * @param {{ log: (event: object) => Promise<unknown> }} [opts.auditLogger] hash-chain audit logger
 * @param {Record<string, string | undefined>} [opts.env] environment source
 * @param {string} [opts.publicUrl] canonical resource URI for WWW-Authenticate
 * @param {ReturnType<typeof import('./mcp-rate-limit.mjs').createRateLimits>} [opts.limits]
 */
export function createMcpHttpHandler({
  authMiddleware,
  auditLogger,
  env = process.env,
  publicUrl = null,
  limits = createRateLimits(env),
} = {}) {
  const resourceUrl = publicUrl || env.MCP_PUBLIC_URL || `http://localhost:${env.PORT || 3000}/mcp`;
  const resourceMetadata = `${resourceUrl.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource/mcp`;
  const allowedOrigins = parseOrigins(env.MCP_ALLOWED_ORIGINS);
  const maxBodyBytes = Number(env.MCP_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  const requireAuth = env.MCP_HTTP_ALLOW_ANONYMOUS !== '1';
  // RFC8707 binding: strict whenever a canonical public URL is configured (any
  // real deployment); MCP_REQUIRE_RESOURCE_AUDIENCE overrides either way.
  const requireResourceAudience = env.MCP_REQUIRE_RESOURCE_AUDIENCE
    ? env.MCP_REQUIRE_RESOURCE_AUDIENCE === '1'
    : Boolean(env.MCP_PUBLIC_URL);

  async function authenticate(req) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return { ok: false, error: 'Access token required' };
    }
    const jwt = validateAccessToken(token, undefined, {
      resource: requireResourceAudience ? resourceUrl : null,
      allowLegacyAudience: !requireResourceAudience,
    });
    if (jwt.valid) {
      return { ok: true, token, context: jwt.context };
    }
    if (authMiddleware?.validateDevToken) {
      const dev = await authMiddleware.validateDevToken(token);
      if (dev.valid) {
        return { ok: true, token, context: { tenantId: dev.tenant.id } };
      }
      return { ok: false, error: dev.error || 'Invalid token' };
    }
    return { ok: false, error: jwt.error || 'Invalid token' };
  }

  return async function handleMcpRequest(req, res, body = null) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed; use POST /mcp' }, { Allow: 'POST' });
      return;
    }

    const origin = req.headers.origin;
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      sendJson(res, 403, { error: `Origin not allowed: ${origin}` });
      return;
    }

    const version = req.headers['mcp-protocol-version'];
    if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      sendJson(res, 400, {
        error: 'Unsupported MCP-Protocol-Version',
        supported: SUPPORTED_PROTOCOL_VERSIONS,
      });
      return;
    }

    let accessToken = null;
    let callerKey = req.headers.authorization ? null : req.socket?.remoteAddress || 'unknown';
    if (requireAuth || req.headers.authorization) {
      const auth = await authenticate(req);
      if (!auth.ok) {
        sendJson(
          res,
          401,
          { error: auth.error },
          {
            'WWW-Authenticate':
              `Bearer error="invalid_token", error_description="${auth.error}", ` +
              `resource_metadata="${resourceMetadata}", scope="read"`,
          },
        );
        return;
      }
      accessToken = auth.token;
      callerKey = auth.context?.tenantId || callerKey || 'unknown';
    }

    // Coarse per-caller bucket on every POST, before any body is read. Discovery
    // and preflight are served elsewhere, so a 429-on-connect loop cannot happen.
    const callerHit = limits.caller.take(callerKey);
    if (!callerHit.allowed) {
      req.resume(); // drain an unread body so the 429 reaches the client
      sendTooManyRequests(res, callerHit.retryAfter, callerHit.limit);
      return;
    }

    let rawBody = body;
    if (rawBody === null || rawBody === undefined) {
      try {
        rawBody = await readBody(req, maxBodyBytes);
      } catch (error) {
        sendJson(res, error.status || 400, { error: error.message });
        return;
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody || '{}');
    } catch {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    // Tighter bucket for the expensive tools, once the JSON-RPC method is known.
    const expensiveTool = expensiveToolOf(parsed);
    if (expensiveTool) {
      const toolHit = limits.tool.take(`${callerKey}:${expensiveTool}`);
      if (!toolHit.allowed) {
        sendTooManyRequests(res, toolHit.retryAfter, toolHit.limit);
        return;
      }
    }

    /**
     * Batch requests (independent review F11). A JSON-RPC array went straight to
     * the SDK dispatch, so a C2 call inside a batch applied unconfirmed. A batch
     * that touches the gate is answered here item by item instead: gated items get
     * `input_required` (or a declined result) and every other item executes through
     * the same SDK request handler the transport would have used. Returns false
     * when nothing in the batch is gated, so the normal path still handles it.
     */
    async function tryGatedBatch(res, items) {
      const calls = items.filter(item => item?.method === 'tools/call');
      if (!calls.length) {
        return false;
      }
      const decisions = calls.map(item =>
        gate(item.params?.name, item.params?.arguments || {}, item.params?.inputResponses),
      );
      if (!decisions.some(decision => decision.action !== 'none')) {
        return false;
      }

      const server = new McpServer({ name: 'callforge', version: '0.2.0' });
      await registerTools(server, {
        auditLogger,
        authMiddleware,
        accessToken,
        remote: { authenticated: requireAuth },
      });
      const extra = {
        signal: new AbortController().signal,
        sendRequest: async () => {},
        sendNotification: async () => {},
      };
      const logElicitation = (toolName, event, payload = {}) =>
        auditLogger
          ?.log({
            tenant_id: callerKey === 'unknown' ? null : callerKey,
            event_type: event,
            actor_type: 'agent',
            action: toolName,
            payload: { tool: toolName, changed: payload.changed, reason: payload.reason },
          })
          .catch(() => {});
      const run = async item => {
        const handler = server.server['_requestHandlers'].get(item.method);
        if (!handler) {
          return { error: { code: -32601, message: 'Method not found' } };
        }
        try {
          return { result: await handler({ ...item, jsonrpc: '2.0' }, extra) };
        } catch (error) {
          return {
            error: { code: error?.code ?? -32603, message: error?.message || 'Internal error' },
          };
        }
      };
      const byItem = new Map(calls.map((item, index) => [item, decisions[index]]));
      const responses = [];
      try {
        for (const item of items) {
          const decision = byItem.get(item) || { action: 'none' };
          const toolName = item?.method === 'tools/call' ? item.params?.name : null;
          const toolArgs = item?.params?.arguments || {};
          let outcome;
          if (decision.action === 'require') {
            await logElicitation(toolName, 'elicitation_requested');
            outcome = {
              result: {
                resultType: 'input_required',
                inputRequests: decision.inputRequests,
                requestState: decision.inputRequests.confirm.requestState,
              },
            };
          } else if (decision.action === 'declined') {
            const body = declinedResult(toolName, toolArgs, decision.reason);
            await logElicitation(toolName, 'elicitation_declined', {
              changed: body.changed,
              reason: decision.reason,
            });
            outcome = {
              result: {
                content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
                structuredContent: body,
              },
            };
          } else {
            if (decision.action === 'accept') {
              const resumeWith = item.params?.requestState;
              // A stale confirmation must not apply to a different set of changes.
              if (resumeWith !== undefined && !stateMatches(resumeWith, toolName, toolArgs)) {
                const reissued = gate(toolName, toolArgs);
                await logElicitation(toolName, 'elicitation_requested', {
                  reason: 'stale requestState',
                });
                if (reissued.action === 'require') {
                  outcome = {
                    result: {
                      resultType: 'input_required',
                      inputRequests: reissued.inputRequests,
                      requestState: reissued.inputRequests.confirm.requestState,
                    },
                  };
                }
              } else {
                await logElicitation(toolName, 'elicitation_accepted', {
                  changed: decision.changed,
                });
              }
            }
            if (!outcome) {
              const { inputResponses: _i, requestState: _s, ...params } = item.params || {};
              void _i;
              void _s;
              outcome = await run({ ...item, params });
            }
          }
          // JSON-RPC notifications in a batch get no response entry.
          if (item?.id !== undefined) {
            responses.push({ jsonrpc: '2.0', id: item.id, ...outcome });
          }
        }
        sendJson(res, 200, responses.length === 1 && items.length === 1 ? responses[0] : responses);
      } finally {
        Promise.resolve(server.close()).catch(() => {});
      }
      return true;
    }

    if (env.MCP_ELICITATION_GATE !== '0' && Array.isArray(parsed)) {
      if (await tryGatedBatch(res, parsed)) {
        return;
      }
    }

    // C2 confirmation gate (design §7E). Annotations are hints; this is the
    // enforcement point. Stateless, so the first call answers `input_required`
    // and the client resumes with `inputResponses` + the returned requestState.
    const call = !Array.isArray(parsed) && parsed?.method === 'tools/call' ? parsed : null;
    if (call && env.MCP_ELICITATION_GATE !== '0') {
      const toolName = call.params?.name;
      const toolArgs = call.params?.arguments || {};
      const decision = gate(toolName, toolArgs, call.params?.inputResponses);
      const resumeWith = call.params?.requestState;
      const logElicitation = (event, extra = {}) =>
        auditLogger
          ?.log({
            tenant_id: callerKey === 'unknown' ? null : callerKey,
            event_type: event,
            actor_type: 'agent',
            action: toolName,
            payload: { tool: toolName, changed: extra.changed, reason: extra.reason },
          })
          .catch(() => {});
      const rpcResult = result =>
        sendJson(res, 200, { jsonrpc: '2.0', id: parsed.id ?? null, result });

      if (decision.action === 'require') {
        await logElicitation('elicitation_requested');
        rpcResult({
          resultType: 'input_required',
          inputRequests: decision.inputRequests,
          requestState: decision.inputRequests.confirm.requestState,
        });
        return;
      }
      if (decision.action === 'accept') {
        // A stale confirmation must not apply to a different set of changes.
        if (resumeWith !== undefined && !stateMatches(resumeWith, toolName, toolArgs)) {
          const reissued = gate(toolName, toolArgs);
          await logElicitation('elicitation_requested', { reason: 'stale requestState' });
          if (reissued.action === 'require') {
            rpcResult({
              resultType: 'input_required',
              inputRequests: reissued.inputRequests,
              requestState: reissued.inputRequests.confirm.requestState,
            });
          }
          return;
        }
        await logElicitation('elicitation_accepted', { changed: decision.changed });
        const { inputResponses: _i, requestState: _s, ...rest } = call.params;
        void _i;
        void _s;
        call.params = rest;
      }
      if (decision.action === 'declined') {
        const body = declinedResult(toolName, toolArgs, decision.reason);
        await logElicitation('elicitation_declined', {
          changed: body.changed,
          reason: decision.reason,
        });
        rpcResult({
          content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
          structuredContent: body,
        });
        return;
      }
    }

    const server = new McpServer({ name: 'callforge', version: '0.2.0' });
    // Stateless + plain JSON replies: no session store, and clients that do not
    // read an SSE stream still get a complete response for every request.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      Promise.resolve(transport.close()).catch(() => {});
      Promise.resolve(server.close()).catch(() => {});
    };
    res.on('close', close);

    try {
      await registerTools(server, {
        auditLogger,
        authMiddleware,
        accessToken,
        remote: { authenticated: requireAuth },
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      console.error('[mcp-http] request failed:', error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'MCP transport error' });
      }
      close();
    }
  };
}

/**
 * Base URL for the deployment. Discovery documents MUST carry absolute URIs
 * (RFC8414 §2), so this is derived once and shared by both metadata builders.
 */
export function publicBaseUrl(env = process.env) {
  if (env.MCP_PUBLIC_URL) {
    try {
      return new URL(env.MCP_PUBLIC_URL).origin;
    } catch {
      // A malformed override must not take discovery down with it.
    }
  }
  return `http://localhost:${env.PORT || 3000}`;
}

/** RFC9728 protected-resource metadata (informational, unauthenticated). */
/** @param {Record<string, string | undefined>} [env] */
export function protectedResourceMetadata(env = process.env) {
  const base = publicBaseUrl(env);
  return {
    resource: env.MCP_PUBLIC_URL || `${base}/mcp`,
    resource_name: env.MCP_RESOURCE_NAME || 'CallForge MCP',
    authorization_servers: [env.MCP_AUTHORIZATION_SERVER || base],
    scopes_supported: ['read', 'simulate', 'write', 'admin', 'audit'],
    bearer_methods_supported: ['header'],
    tls_client_certificate_bound_access_tokens: false,
    resource_documentation: env.MCP_RESOURCE_DOCUMENTATION || undefined,
  };
}

/**
 * RFC8414 authorization-server metadata. The simulation issuer reuses the same
 * origin, so endpoints are absolute and resource indicators (RFC8707) are
 * advertised so clients know to send `resource` at authorize time.
 */
export function authorizationServerMetadata(env = process.env) {
  const base = publicBaseUrl(env);
  return {
    issuer: env.MCP_AUTHORIZATION_SERVER || base,
    audience: AUDIENCE,
    issuer_name: ISSUER,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    jwks_uri: env.MCP_JWKS_URI || undefined,
    scopes_supported: ['read', 'simulate', 'write', 'admin', 'audit'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    resource_indicators_supported: true,
    authorization_response_iss_parameter_supported: false,
  };
}

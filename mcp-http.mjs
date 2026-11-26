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
import { validateAccessToken } from './oauth.mjs';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-11-25', '2026-07-28'];
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

function parseOrigins(value) {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
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
 */
export function createMcpHttpHandler({
  authMiddleware,
  auditLogger,
  env = process.env,
  publicUrl = null,
} = {}) {
  const resourceUrl = publicUrl || env.MCP_PUBLIC_URL || `http://localhost:${env.PORT || 3000}/mcp`;
  const resourceMetadata = `${resourceUrl.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource/mcp`;
  const allowedOrigins = parseOrigins(env.MCP_ALLOWED_ORIGINS);
  const maxBodyBytes = Number(env.MCP_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  const requireAuth = env.MCP_HTTP_ALLOW_ANONYMOUS !== '1';

  async function authenticate(req) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return { ok: false, error: 'Access token required' };
    }
    const jwt = validateAccessToken(token);
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
    if (requireAuth || req.headers.authorization) {
      const auth = await authenticate(req);
      if (!auth.ok) {
        sendJson(
          res,
          401,
          { error: auth.error },
          {
            'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadata}", scope="read"`,
          },
        );
        return;
      }
      accessToken = auth.token;
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
      await registerTools(server, { auditLogger, authMiddleware, accessToken });
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

/** RFC9728 protected-resource metadata (informational, unauthenticated). */
/** @param {Record<string, string | undefined>} [env] */
export function protectedResourceMetadata(env = process.env) {
  const resourceUrl = env.MCP_PUBLIC_URL || `http://localhost:${env.PORT || 3000}/mcp`;
  return {
    resource: resourceUrl,
    authorization_servers: [env.MCP_AUTHORIZATION_SERVER || resourceUrl.replace(/\/mcp$/, '')],
    scopes_supported: ['read', 'simulate', 'write', 'admin', 'audit'],
    bearer_methods_supported: ['header'],
    resource_documentation: env.MCP_RESOURCE_DOCUMENTATION || undefined,
  };
}

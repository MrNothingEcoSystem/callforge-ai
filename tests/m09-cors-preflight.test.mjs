/**
 * CALLFORGE AI — M09 CORS preflight (review finding F2)
 *
 * The transport enforces an Origin allow-list on POST /mcp; the HTTP server must
 * preflight against the same list, otherwise a disallowed browser origin gets a
 * 204 and only then a 403 on the actual request.
 */
process.env.CALLFORGE_ALLOW_DEV_SECRET = 'true';
process.env.CALLFORGE_TOKEN_SECRET = 'test-cors-preflight-secret';
process.env.PORT = '0';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { closeStore, setTestDatabasePath } from '../store.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-cors-'));
setTestDatabasePath(join(DIR, 'callforge.db'));

const ALLOWED = 'https://chat.example';
const BLOCKED = 'https://evil.example';

let CallforgeHttpServer;

function call(port, path, method, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('POST /mcp CORS preflight honours the Origin allow-list', () => {
  let server;
  let port;

  beforeAll(async () => {
    process.env.MCP_ALLOWED_ORIGINS = `${ALLOWED}, ${BLOCKED.replace('evil', 'other')}`;
    ({ CallforgeHttpServer } = await import('../server.mjs'));
    server = new CallforgeHttpServer();
    await server.initialize();
    server.start();
    await new Promise(resolve => server.server.once('listening', resolve));
    port = server.server.address().port;
  });

  afterAll(async () => {
    await server.shutdown();
    await closeStore();
  });

  it('answers an allowed origin with the echoed origin and Vary', async () => {
    const res = await call(port, '/mcp', 'OPTIONS', { origin: ALLOWED });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers.vary).toBe('Origin');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('403s a preflight from an unlisted origin', async () => {
    const res = await call(port, '/mcp', 'OPTIONS', { origin: BLOCKED });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe(`Origin not allowed: ${BLOCKED}`);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps the wildcard for a preflight with no Origin', async () => {
    const res = await call(port, '/mcp', 'OPTIONS');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('falls back to the wildcard when no allow-list is configured', async () => {
    const saved = process.env.MCP_ALLOWED_ORIGINS;
    delete process.env.MCP_ALLOWED_ORIGINS;
    const other = new CallforgeHttpServer();
    try {
      await other.initialize();
      other.start();
      await new Promise(resolve => other.server.once('listening', resolve));
      const res = await call(other.server.address().port, '/mcp', 'OPTIONS', { origin: BLOCKED });
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    } finally {
      await other.shutdown();
      process.env.MCP_ALLOWED_ORIGINS = saved;
    }
  });

  it('leaves non-MCP endpoints on the historical wildcard', async () => {
    const res = await call(port, '/health', 'OPTIONS', { origin: BLOCKED });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

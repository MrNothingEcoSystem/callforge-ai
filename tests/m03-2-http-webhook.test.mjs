import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// F4/F5/invalid-request regression tests (review remediation, 2026-11-09).
// Uses mock req/res per the repo's server.test.mjs pattern.
process.env.WEBHOOK_SECRET = 'rev-http-secret';
process.env.MAX_WEBHOOK_BODY_BYTES = '1024';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'callforge-m032-http-'));

let srv;

async function* bodyStream(body) {
  yield Buffer.from(body);
}

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

const sign = body => createHmac('sha256', process.env.WEBHOOK_SECRET).update(body).digest('hex');

async function callWebhook(provider, body, headers = {}) {
  const res = createRes();
  const req = { headers, [Symbol.asyncIterator]: () => bodyStream(body) };
  await srv.handleWebhook(req, res, provider);
  return { status: res.statusCode, body: res.body };
}

describe('M03-2 webhook handler edge cases (F4/F5)', () => {
  beforeAll(async () => {
    const { setTestDatabasePath, initDatabase } = await import('../store.mjs');
    setTestDatabasePath(join(TEST_DIR, 'callforge.db'));
    await initDatabase();
    const { CallforgeHttpServer } = await import('../server.mjs');
    srv = new CallforgeHttpServer();
  });

  afterAll(async () => {
    const { closeStore } = await import('../store.mjs');
    await closeStore();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('invalid provider identifier (slashes) → 400, nothing stored', async () => {
    const body = '{"http":1}';
    const r = await callWebhook('a/b', body, { 'x-signature': sign(body) });
    expect(r.status).toBe(400);
    const { getDatabase } = await import('../store.mjs');
    const n = getDatabase()
      .prepare("SELECT COUNT(*) n FROM webhook_inbox WHERE provider LIKE '%/%'")
      .get().n;
    expect(n).toBe(0);
  });

  it('oversized payload → 413 before HMAC verification', async () => {
    const body = 'x'.repeat(4096);
    const r = await callWebhook('twilio', body, { 'x-signature': sign(body) });
    expect(r.status).toBe(413);
  });

  it('malformed signature → 401, nothing stored', async () => {
    const body = '{"http":2}';
    const r = await callWebhook('twilio', body, { 'x-signature': 'not-hex' });
    expect(r.status).toBe(401);
    const { getDatabase } = await import('../store.mjs');
    const n = getDatabase()
      .prepare("SELECT COUNT(*) n FROM webhook_inbox WHERE provider='twilio' AND raw_body=?")
      .get(body).n;
    expect(n).toBe(0);
  });

  it('valid signature → 202, replay → 200 single row', async () => {
    const body = '{"http":3}';
    const r1 = await callWebhook('twilio', body, { 'x-signature': sign(body) });
    const r2 = await callWebhook('twilio', body, { 'x-signature': sign(body) });
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(200);
    const { getDatabase } = await import('../store.mjs');
    const n = getDatabase()
      .prepare('SELECT COUNT(*) n FROM webhook_inbox WHERE provider=? AND raw_body=?')
      .get('twilio', body).n;
    expect(n).toBe(1);
  });
});

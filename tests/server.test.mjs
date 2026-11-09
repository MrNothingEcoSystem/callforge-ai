import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { CallforgeHttpServer } from '../server.mjs';
import {
  closeStore,
  generateId,
  getDatabase,
  initDatabase,
  setTestDatabasePath,
} from '../store.mjs';

const TEST_DB_DIR = join(process.cwd(), 'data', 'test-server');
const TEST_DB_PATH = join(TEST_DB_DIR, 'callforge.db');

function createResponse() {
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

describe('HTTP simulation tenant isolation', () => {
  const tenantA = generateId();
  const tenantB = generateId();
  const callIntentId = generateId();

  beforeAll(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    setTestDatabasePath(TEST_DB_PATH);
    await initDatabase();
    const db = getDatabase();
    db.prepare('DELETE FROM call_intents').run();
    db.prepare('DELETE FROM tenants').run();
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantA, 'A', '{}');
    db.prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantB, 'B', '{}');
    db.prepare(
      'INSERT INTO call_intents (id, tenant_id, idempotency_key, direction, status) VALUES (?, ?, ?, ?, ?)',
    ).run(callIntentId, tenantB, 'tenant-b-call', 'outbound', 'pending');
  });

  afterAll(async () => {
    await closeStore();
  });

  it('does not return another tenant call intent by ID', async () => {
    const server = new CallforgeHttpServer();
    const response = createResponse();

    await server.handleSimulateStatus({}, response, {
      tenant_id: tenantA,
      call_intent_id: callIntentId,
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toBe('Call intent not found');
  });
});

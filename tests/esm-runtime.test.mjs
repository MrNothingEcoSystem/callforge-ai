import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('declared Node.js ESM runtime', () => {
  it('creates a development token without CommonJS require', () => {
    const databaseDir = mkdtempSync(join(tmpdir(), 'callforge-esm-'));
    const program = `
      import { initDatabase, getDatabase, closeStore, generateId } from './store.mjs';
      import { createAuthMiddleware } from './auth.mjs';
      await initDatabase();
      const tenantId = generateId();
      getDatabase().prepare('INSERT INTO tenants (id, name, settings) VALUES (?, ?, ?)').run(tenantId, 'ESM Tenant', '{}');
      const token = await createAuthMiddleware().createDevToken(tenantId, 'ESM smoke', ['simulate'], 1);
      if (!token.token.startsWith('cf_dev_')) throw new Error('token not created');
      await closeStore();
      console.log('esm-token-ok');
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: process.cwd(),
      env: { ...process.env, CALLFORGE_DB_DIR: databaseDir },
      encoding: 'utf8',
    });

    rmSync(databaseDir, { recursive: true, force: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('esm-token-ok');
  });

  it('initializes and shuts down the HTTP simulation server', () => {
    const databaseDir = mkdtempSync(join(tmpdir(), 'callforge-http-'));
    const program = `
      import { CallforgeHttpServer } from './server.mjs';
      const server = new CallforgeHttpServer();
      await server.initialize();
      await server.shutdown();
      console.log('http-server-ok');
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: process.cwd(),
      env: { ...process.env, CALLFORGE_DB_DIR: databaseDir },
      encoding: 'utf8',
    });

    rmSync(databaseDir, { recursive: true, force: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('http-server-ok');
  });

  it('starts, listens on an ephemeral port, and shuts down (issue #6)', () => {
    const databaseDir = mkdtempSync(join(tmpdir(), 'callforge-http-start-'));
    const program = `
      import { CallforgeHttpServer } from './server.mjs';
      const server = new CallforgeHttpServer();
      await server.initialize();
      server.start();
      let addr = null;
      for (let i = 0; i < 50 && !addr; i++) {
        addr = server.server.address();
        if (!addr) await new Promise(r => setTimeout(r, 50));
      }
      if (!addr) throw new Error('server did not start listening');
      const res = await fetch('http://127.0.0.1:' + addr.port + '/health');
      if (!res.ok) throw new Error('health check failed: ' + res.status);
      const body = await res.json();
      if (body.status !== 'ok') throw new Error('unexpected health body');
      await server.shutdown();
      console.log('http-start-ok');
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: process.cwd(),
      env: { ...process.env, CALLFORGE_DB_DIR: databaseDir, PORT: '0' },
      encoding: 'utf8',
    });

    rmSync(databaseDir, { recursive: true, force: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('http-start-ok');
  });
});

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

  it('binds a real socket via start(), serves /health, and closes cleanly', () => {
    const databaseDir = mkdtempSync(join(tmpdir(), 'callforge-http-start-'));
    const port = 31000 + Math.floor(Math.random() * 2000);
    const program = `
      import { CallforgeHttpServer } from './server.mjs';
      const server = new CallforgeHttpServer();
      await server.initialize();
      server.start();
      let res;
      for (let i = 0; i < 50; i++) {
        try { res = await fetch('http://127.0.0.1:${port}/health'); break; }
        catch { await new Promise(r => setTimeout(r, 100)); }
      }
      if (!res || res.status !== 200) throw new Error('server did not serve /health');
      const body = await res.json();
      if (body.status !== 'ok') throw new Error('unexpected /health body');
      await server.shutdown();
      console.log('http-start-ok');
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: process.cwd(),
      env: { ...process.env, CALLFORGE_DB_DIR: databaseDir, PORT: String(port) },
      encoding: 'utf8',
      timeout: 30000,
    });

    rmSync(databaseDir, { recursive: true, force: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('http-start-ok');
  });
});

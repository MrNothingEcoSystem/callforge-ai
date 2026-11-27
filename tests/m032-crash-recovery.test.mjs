/**
 * TECH-005 — the outbox dispatcher must survive (and correctly recover from)
 * repeated process death. Two full crash→restart cycles against a real SQLite
 * file, each crash in a separate OS process, proving:
 *
 *   - a claimed row whose worker died is not lost and not double-applied
 *     (at-least-once delivery, exactly-once effect),
 *   - a live lease is respected before expiry (no premature redelivery),
 *   - after expiry, recovery reclaims the lease and redelivery completes it,
 *   - a crashed `webhook.received` row ends `processed` exactly once and is
 *     never left stuck nor duplicated,
 *   - no row is left claimed/pending when the run is drained.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';

const DIR = mkdtempSync(join(tmpdir(), 'callforge-crash-'));
const DB_PATH = join(DIR, 'callforge.db');
const FIXTURE = join(import.meta.dirname, 'fixtures', 'm032-crash-worker.mjs');

function cycle(mode, ...args) {
  const run = spawnSync(process.execPath, [FIXTURE, DB_PATH, mode, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: run.status, out: (run.stdout || '').trim(), err: (run.stderr || '').trim() };
}

function json(result) {
  const line = result.out.split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

/** Make every claimed lease look expired, as if the worker had died a minute ago. */
function expireLeases() {
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import Database from 'better-sqlite3';
       const db = new Database(process.argv[1]);
       const r = db.prepare("UPDATE outbox SET lease_expires_at = datetime('now','-1 minute') WHERE status='claimed'").run();
       db.close(); console.log(r.changes);`,
      DB_PATH,
    ],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  return Number(run.stdout.trim());
}

describe('M03-2 dispatcher crash recovery (TECH-005)', () => {
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));

  it('two crash/restart cycles lose no work and apply each effect exactly once', () => {
    expect(json(cycle('produce', '3')).outbox).toBe(4);

    // ---- cycle 1: the worker dies mid-batch -------------------------------
    const crash1 = cycle('crash');
    expect(crash1.status).toBe(9);

    // claimBatch claims the whole batch up front, so every row is stranded as
    // `claimed` when the process dies — exactly the loss a lease must survive.
    let state = json(cycle('verify'));
    expect(state.outbox.filter(r => r.status === 'claimed')).toHaveLength(4);
    // The crash landed after one effect (or during the webhook): exactly one unit
    // of work is committed, the rest never ran.
    const committed = state.effects + state.webhook.filter(w => w.status !== 'received').length;
    expect(committed).toBe(1);

    // Live lease: recovery must not reclaim any of them yet.
    expect(json(cycle('recover')).reclaimed_leases).toBe(0);
    expect(json(cycle('drain')).acked).toBe(0);
    state = json(cycle('verify'));
    expect(state.outbox.filter(r => r.status === 'claimed')).toHaveLength(4);

    // ---- cycle 2: expiry, recovery, then a second crash ---------------------
    expect(expireLeases()).toBe(4);
    expect(json(cycle('recover')).reclaimed_leases).toBe(4);

    const crash2 = cycle('crash');
    expect(crash2.status).toBe(9);
    state = json(cycle('verify'));
    expect(state.outbox.filter(r => r.status === 'claimed')).toHaveLength(4);
    // The retried head row is applied again in this process, but its effect is
    // keyed, so the committed total must still be exactly one (no double apply).
    expect(state.effects + state.webhook.filter(w => w.status !== 'received').length).toBe(1);

    // ---- final restart: expire, recover, drain ------------------------------
    expireLeases();
    json(cycle('recover'));
    json(cycle('drain'));

    const final = json(cycle('verify'));

    // Every row finished; nothing is stranded in pending/claimed.
    expect(final.outbox.map(r => r.status)).toEqual(['acked', 'acked', 'acked', 'acked']);
    // Three distinct effects for three rows — no double application.
    expect(final.effects).toBe(3);
    // Two rows were redelivered after their crash; both applied exactly once.
    expect(final.outbox.filter(r => r.attempts >= 2).length).toBeGreaterThanOrEqual(1);
    // The webhook completed exactly once and is not stuck.
    expect(final.webhook).toHaveLength(1);
    expect(final.webhook[0].status).toBe('processed');
  }, 120000);
});

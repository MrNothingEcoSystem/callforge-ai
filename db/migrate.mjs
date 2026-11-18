/**
 * CALLFORGE AI — Versioned migration runner (M03-1)
 *
 * Applies ordered db/migrations/*.sql files exactly once, each in its own
 * transaction, recording version + checksum in schema_migrations.
 * Checksum drift on an already-applied migration is a hard failure.
 * Forward-only: rollback is restore-from-backup.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function bootstrap(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );
}

export function listMigrations(dir = DEFAULT_DIR) {
  return readdirSync(dir)
    .filter(f => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map(file => {
      const version = file.slice(0, 4);
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      return { version, name: file, sql, checksum };
    });
}

export function runMigrations(db, dir = DEFAULT_DIR) {
  bootstrap(db);
  const applied = [];
  const skipped = [];
  const recorded = new Map(
    db
      .prepare('SELECT version, checksum FROM schema_migrations')
      .all()
      .map(r => [r.version, r.checksum]),
  );

  for (const migration of listMigrations(dir)) {
    const existing = recorded.get(migration.version);
    if (existing) {
      if (existing !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum drift detected`);
      }
      skipped.push(migration.version);
      continue;
    }
    const apply = db.transaction(sql => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        migration.checksum,
      );
    });
    apply(migration.sql);
    applied.push(migration.version);
  }
  return { applied, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] || join(process.cwd(), 'data', 'callforge.db');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path);
  const result = runMigrations(db);
  console.log(JSON.stringify({ database: path, ...result }));
  db.close();
}

/**
 * CALLFORGE AI — Backup / restore (M03-1)
 *
 * VACUUM INTO gives an online-safe snapshot; restore copies to a temp
 * path, verifies integrity, then atomically renames over the live file.
 * The caller must close the live database before restore.
 */
import { renameSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Database from 'better-sqlite3';

export function backupDatabase(db, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const manifest = {
    file: targetPath,
    integrity_check: integrity,
    head_migration:
      db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()
        ?.version || null,
    created_at: new Date().toISOString(),
  };
  writeFileSync(`${targetPath}.manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function restoreDatabase(backupPath, livePath) {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  const src = new Database(backupPath, { readonly: true });
  const checkRow = src.prepare('PRAGMA integrity_check').get();
  const integrity = checkRow
    ? /** @type {{ integrity_check: string }} */ (checkRow).integrity_check
    : 'unknown';
  src.close();
  if (integrity !== 'ok') {
    throw new Error(`Backup integrity check failed: ${integrity}`);
  }
  const tmp = join(dirname(livePath), '.callforge-restore-tmp.db');
  copyFileSync(backupPath, tmp);
  renameSync(tmp, livePath);
  return { restored: true, integrity_check: integrity };
}

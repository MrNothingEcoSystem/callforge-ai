/**
 * CALLFORGE AI — Durable outbox (M03-1)
 *
 * At-least-once delivery with idempotent effects. enqueue() is called
 * inside the producer's transaction so a state change and its outbox row
 * commit atomically. claimBatch uses a single UPDATE…RETURNING, which is
 * race-free under SQLite's single writer; expired leases make crashed
 * workers recoverable.
 */
import { generateId } from '../store.mjs';

export function enqueue(
  db,
  { tenantId, aggregateType, aggregateId, type, payload = {}, dedupKey = null },
) {
  const id = generateId();
  if (dedupKey) {
    const existing = db
      .prepare('SELECT * FROM outbox WHERE tenant_id = ? AND dedup_key = ?')
      .get(tenantId, dedupKey);
    if (existing) {
      return { row: existing, inserted: false };
    }
  }
  db.prepare(
    `INSERT INTO outbox (id, tenant_id, aggregate_type, aggregate_id, type, payload, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenantId, aggregateType, aggregateId, type, JSON.stringify(payload), dedupKey);
  const row = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id);
  return { row, inserted: true };
}

export function claimBatch(db, { workerId, limit = 10, leaseSeconds = 60 }) {
  const rows = db
    .prepare(
      `UPDATE outbox
       SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'),
           lease_expires_at = datetime('now', ?), attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox
         WHERE status = 'pending'
            OR (status = 'claimed' AND lease_expires_at < datetime('now'))
         ORDER BY available_at
         LIMIT ?
       )
       RETURNING *`,
    )
    .all(workerId, `+${leaseSeconds} seconds`, limit);
  return rows;
}

export function ack(db, id, workerId) {
  const result = db
    .prepare(
      `UPDATE outbox SET status = 'acked', acked_at = datetime('now')
       WHERE id = ? AND claimed_by = ? AND status = 'claimed'`,
    )
    .run(id, workerId);
  return result.changes === 1;
}

const MAX_ATTEMPTS = 5;

export function fail(db, id, workerId, error) {
  const row = db.prepare('SELECT attempts FROM outbox WHERE id = ?').get(id);
  if (!row) {
    return false;
  }
  const dead = row.attempts >= MAX_ATTEMPTS;
  const backoffSeconds = Math.min(300, 2 ** row.attempts * 5);
  const result = db
    .prepare(
      `UPDATE outbox
       SET status = ?, last_error = ?,
           available_at = CASE WHEN ? THEN available_at ELSE datetime('now', ?) END
       WHERE id = ? AND claimed_by = ? AND status = 'claimed'`,
    )
    .run(
      dead ? 'dead' : 'pending',
      String(error || 'unknown').slice(0, 500),
      dead ? 1 : 0,
      `+${backoffSeconds} seconds`,
      id,
      workerId,
    );
  return result.changes === 1;
}

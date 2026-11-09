/**
 * CALLFORGE AI — Tenant quota + retention (M03-1 + M03-2)
 *
 * checkQuota/consumeQuota/releaseQuota: atomic single-guarded-UPDATE
 * counters; quota can never exceed its limit under parallel consume.
 * Retention: report-only by default; chunked deletes run only behind the
 * double env gate (RETENTION_ENABLED=1 AND RETENTION_DRY_RUN=0).
 *
 * Quota default (F-M03-2c): a tenant with NO tenant_quotas row for a
 * resource is UNLIMITED (fail-open) — checkQuota returns {allowed:true}.
 * consumeQuota still fails closed ({consumed:false}) when no row exists,
 * so callers MUST use getQuotaRow and only treat deny as a limit when a
 * row actually exists. Enforced by POST /simulate/call (consume on
 * create) and released by stateMachine transitions to rejected/cancelled.
 * A limit_value <= 0 also means unlimited; otherwise the limit is a hard
 * cap enforced atomically at consume time.
 */

/** Returns the quota rule row, or undefined when the tenant is unlimited. */
export function getQuotaRow(db, tenantId, resource) {
  return db
    .prepare('SELECT limit_value, used FROM tenant_quotas WHERE tenant_id = ? AND resource = ?')
    .get(tenantId, resource);
}

export function checkQuota(db, tenantId, resource) {
  const row = getQuotaRow(db, tenantId, resource);
  if (!row || row.limit_value <= 0) {
    return { allowed: true };
  }
  if (row.used >= row.limit_value) {
    return { allowed: false, reason: 'quota_exceeded', limit: row.limit_value, used: row.used };
  }
  return { allowed: true, limit: row.limit_value, used: row.used };
}

export function applyRetention(db, { dryRun = true } = {}) {
  const policies = db.prepare('SELECT * FROM retention_policies').all();
  const report = [];
  for (const policy of policies) {
    const days = policy.retain_days;
    let deletable = 0;
    if (policy.resource === 'audit_events') {
      deletable = db
        .prepare(
          `SELECT COUNT(*) AS n FROM audit_events
                  WHERE tenant_id = ? AND created_at < datetime('now', ?)`,
        )
        .get(policy.tenant_id, `-${days} days`).n;
    } else if (policy.resource === 'call_events') {
      deletable = db
        .prepare(
          `SELECT COUNT(*) AS n FROM call_events ce
                  JOIN call_intents ci ON ci.id = ce.call_intent_id
                  WHERE ci.tenant_id = ? AND ci.status IN ('completed','failed','rejected','cancelled')
                    AND ce.created_at < datetime('now', ?)`,
        )
        .get(policy.tenant_id, `-${days} days`).n;
    } else if (policy.resource === 'outbox') {
      deletable = db
        .prepare(
          `SELECT COUNT(*) AS n FROM outbox
                  WHERE tenant_id = ? AND status = 'acked' AND acked_at < datetime('now', ?)`,
        )
        .get(policy.tenant_id, `-${days} days`).n;
    }
    report.push({
      tenant_id: policy.tenant_id,
      resource: policy.resource,
      retain_days: days,
      deletable,
      dry_run: dryRun,
      ...(policy.resource === 'audit_events' ? { excluded: 'audit_chain_protected' } : {}),
    });
  }
  return report;
}

/**
 * M03-2: atomically consume one unit. Single guarded UPDATE…RETURNING —
 * used < limit is checked in the same statement, so parallel consumes can
 * never exceed the limit. Returns false when at/over limit or no quota row.
 */
export function consumeQuota(db, tenantId, resource) {
  const row = db
    .prepare(
      `UPDATE tenant_quotas SET used = used + 1
       WHERE tenant_id = ? AND resource = ? AND (limit_value <= 0 OR used < limit_value)
       RETURNING used, limit_value`,
    )
    .get(tenantId, resource);
  return row ? { consumed: true, used: row.used, limit: row.limit_value } : { consumed: false };
}

/** M03-2: release one unit (never below zero). */
export function releaseQuota(db, tenantId, resource) {
  const row = db
    .prepare(
      `UPDATE tenant_quotas SET used = MAX(used - 1, 0)
       WHERE tenant_id = ? AND resource = ? RETURNING used`,
    )
    .get(tenantId, resource);
  return row ? { released: true, used: row.used } : { released: false };
}

// F3 (review 2026-11-09): audit_events is EXCLUDED from destructive
// retention. Rows are hash-linked (audit.mjs); deleting any row breaks
// verifyChain and silently resets the genesis anchor. Archival/deletion
// requires an explicit owner-approved policy that preserves chain
// checkpoints — pending. Kept in the map only to report the exclusion.
const RETENTION_PROTECTED = new Set(['audit_events']);

const RETENTION_DELETE_SQL = {
  call_events: `DELETE FROM call_events WHERE id IN (
    SELECT ce.id FROM call_events ce JOIN call_intents ci ON ci.id = ce.call_intent_id
    WHERE ci.tenant_id = ? AND ci.status IN ('completed','failed','rejected','cancelled')
      AND ce.created_at < datetime('now', ?) LIMIT 500)`,
  outbox: `DELETE FROM outbox WHERE id IN (
    SELECT id FROM outbox WHERE tenant_id = ? AND status = 'acked'
      AND acked_at < datetime('now', ?) LIMIT 500)`,
};

/** M03-2: plan what would be deleted (report-only). */
export function planRetention(db) {
  return applyRetention(db, { dryRun: true });
}

/**
 * M03-2: execute chunked deletes (500 rows per statement) behind the double
 * env gate. Both RETENTION_ENABLED=1 and RETENTION_DRY_RUN=0 are required;
 * otherwise report-only. Loop terminates when a chunk deletes nothing.
 */
export function executeRetention(db, { chunkGuard = 1000 } = {}) {
  const enabled = process.env.RETENTION_ENABLED === '1';
  const dryRun = process.env.RETENTION_DRY_RUN !== '0';
  if (!enabled || dryRun) {
    return { executed: false, reason: 'double_gate_closed', report: planRetention(db) };
  }
  const policies = db.prepare('SELECT * FROM retention_policies').all();
  const result = [];
  for (const policy of policies) {
    if (RETENTION_PROTECTED.has(policy.resource)) {
      result.push({
        tenant_id: policy.tenant_id,
        resource: policy.resource,
        deleted: 0,
        excluded: 'audit_chain_protected',
      });
      continue;
    }
    const sql = RETENTION_DELETE_SQL[policy.resource];
    if (!sql) {
      continue;
    }
    let deleted = 0;
    for (let i = 0; i < chunkGuard; i++) {
      const r = db.prepare(sql).run(policy.tenant_id, `-${policy.retain_days} days`);
      deleted += r.changes;
      if (r.changes === 0) {
        break;
      }
    }
    result.push({ tenant_id: policy.tenant_id, resource: policy.resource, deleted });
  }
  return { executed: true, deleted: result };
}

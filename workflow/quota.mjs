/**
 * CALLFORGE AI — Tenant quota + retention hooks (M03-1)
 *
 * checkQuota is enforced at the API layer. applyRetention is dry-run only
 * in M03-1: it reports deletable counts and never deletes.
 */

export function checkQuota(db, tenantId, resource) {
  const row = db
    .prepare('SELECT limit_value, used FROM tenant_quotas WHERE tenant_id = ? AND resource = ?')
    .get(tenantId, resource);
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
    });
  }
  return report;
}

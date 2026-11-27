/**
 * CALLFORGE AI — per-tenant policy record (review #197 F4)
 *
 * The gate's numeric knobs (calling window, retry ceiling, DNCR freshness) are
 * statutory defaults in `policyDefaults.mjs`. A tenant's competent-authority
 * approval can differ, so they live in `tenant_policies` instead of code.
 *
 * Fail-closed shape: an absent row means "use the defaults" (a deliberate
 * default, not an unknown); a row that exists but holds an unusable value
 * returns `options: null` plus violations, and the evaluator denies. A tenor
 * with a broken policy must not get the widest window by accident.
 */
import { POLICY_DEFAULTS, copyPolicyDefaults } from './policyDefaults.mjs';

export const POLICY_BOUNDS = Object.freeze({
  windowHour: { min: 0, max: 24 },
  retryDay: { min: 1, max: 10 },
  retryWeek: { min: 1, max: 20 },
  dncrMaxAgeHours: { min: 1, max: 168 },
});

/** Hours that are valid clock values but no sane calling window covers. */
function isInt(value) {
  return Number.isInteger(value);
}

/**
 * Validate raw option values. Returns the normalised options and the list of
 * violations (empty when usable). Pure — used on write and on read.
 *
 * @param {Record<string, any>} raw
 */
export function validatePolicyOptions(raw = {}) {
  const violations = [];
  const start = raw.callingWindow?.startHour;
  const end = raw.callingWindow?.endHour;
  const day = raw.retryLimits?.day;
  const week = raw.retryLimits?.week;
  const maxAge = raw.dncrMaxAgeHours;
  const timeZone = raw.timeZone ?? POLICY_DEFAULTS.timeZone;

  if (!isInt(start) || start < 0 || start > 24) {
    violations.push(`callingWindow.startHour ${start} is not an hour 0–24`);
  }
  if (!isInt(end) || end < 0 || end > 24) {
    violations.push(`callingWindow.endHour ${end} is not an hour 0–24`);
  }
  if (isInt(start) && isInt(end) && start >= end) {
    violations.push(`calling window ${start}–${end} is empty or inverted`);
  }
  if (!isInt(day) || day < POLICY_BOUNDS.retryDay.min || day > POLICY_BOUNDS.retryDay.max) {
    violations.push(
      `retryLimits.day ${day} is outside ${POLICY_BOUNDS.retryDay.min}–${POLICY_BOUNDS.retryDay.max}`,
    );
  }
  if (!isInt(week) || week < POLICY_BOUNDS.retryWeek.min || week > POLICY_BOUNDS.retryWeek.max) {
    violations.push(
      `retryLimits.week ${week} is outside ${POLICY_BOUNDS.retryWeek.min}–${POLICY_BOUNDS.retryWeek.max}`,
    );
  }
  if (isInt(day) && isInt(week) && day > week) {
    violations.push(`retry ceiling day ${day} exceeds week ${week}`);
  }
  if (
    !isInt(maxAge) ||
    maxAge < POLICY_BOUNDS.dncrMaxAgeHours.min ||
    maxAge > POLICY_BOUNDS.dncrMaxAgeHours.max
  ) {
    violations.push(
      `dncrMaxAgeHours ${maxAge} is outside ${POLICY_BOUNDS.dncrMaxAgeHours.min}–${POLICY_BOUNDS.dncrMaxAgeHours.max}`,
    );
  }
  if (typeof timeZone !== 'string' || !timeZone) {
    violations.push('timeZone is empty');
  }
  if (violations.length > 0) {
    return { options: null, violations };
  }
  return {
    violations,
    options: {
      timeZone,
      callingWindow: { startHour: start, endHour: end },
      retryLimits: { day, week },
      dncrMaxAgeHours: maxAge,
    },
  };
}

/**
 * Read and validate the tenant's stored options.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tenantId
 * @returns {{ options: object | null, source: 'tenant'|'default', version: number, violations: string[] }}
 */
export function readTenantPolicy(db, tenantId) {
  if (!tenantId) {
    throw new TypeError('readTenantPolicy requires tenantId');
  }
  const row = /** @type {any} */ (
    db.prepare('SELECT * FROM tenant_policies WHERE tenant_id = ?').get(tenantId)
  );
  if (!row) {
    return { options: copyPolicyDefaults(), source: 'default', version: 0, violations: [] };
  }
  const { options, violations } = validatePolicyOptions({
    timeZone: row.time_zone,
    callingWindow: { startHour: row.window_start_hour, endHour: row.window_end_hour },
    retryLimits: { day: row.retry_limit_day, week: row.retry_limit_week },
    dncrMaxAgeHours: row.dncr_max_age_hours,
  });
  return { options, source: 'tenant', version: row.version ?? 0, violations };
}

/**
 * Normalise a caller-supplied version fence. `undefined`/`null` means "no
 * fence" (blind last-write-wins); anything else must be a positive integer.
 *
 * @param {unknown} value
 */
export function parsePolicyVersion(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

/**
 * Upsert after validation; throws on an unusable record.
 *
 * Two concurrent writers both read version 3 and both PUT: without a fence the
 * second one silently erases the first. When the caller passes the version it
 * read, the update is conditional on that version and a superseded write
 * returns `{ conflict: true, version: <current> }` having changed nothing — the
 * caller can re-read and retry instead of believing its edit stuck. The check
 * and the write are one statement, so the decision cannot straddle a competing
 * commit. `parsePolicyVersion` is used so a `0` or junk fence degrades to the
 * blind path rather than reading as a guaranteed conflict.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tenantId
 * @param {Record<string, any>} raw
 * @param {unknown} [expectedVersion]
 * @returns {{ options: object | null, version: number | null, conflict: boolean }}
 */
export function writeTenantPolicy(db, tenantId, raw, expectedVersion) {
  const { options, violations } = validatePolicyOptions(raw);
  if (!options) {
    throw new RangeError(`invalid tenant policy: ${violations.join('; ')}`);
  }
  const expect = parsePolicyVersion(expectedVersion);
  if (expect !== null) {
    const current = /** @type {any} */ (
      db.prepare('SELECT version FROM tenant_policies WHERE tenant_id = ?').get(tenantId)
    );
    // A missing row means no override exists; only a fence of 1 (the version a
    // fresh insert carries) can be satisfied by creating it.
    if (!current && expect !== 1) {
      return { options: null, version: null, conflict: true };
    }
    if (current && current.version !== expect) {
      return { options: null, version: current.version, conflict: true };
    }
  }
  const statement = db.prepare(
    `INSERT INTO tenant_policies
       (tenant_id, time_zone, window_start_hour, window_end_hour,
        retry_limit_day, retry_limit_week, dncr_max_age_hours, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT (tenant_id) DO UPDATE SET
       time_zone = excluded.time_zone,
       window_start_hour = excluded.window_start_hour,
       window_end_hour = excluded.window_end_hour,
       retry_limit_day = excluded.retry_limit_day,
       retry_limit_week = excluded.retry_limit_week,
       dncr_max_age_hours = excluded.dncr_max_age_hours,
       version = tenant_policies.version + 1,
       updated_at = datetime('now')${expect !== null ? '\n     WHERE tenant_policies.version = ?' : ''}`,
  );
  const args = [
    tenantId,
    options.timeZone,
    options.callingWindow.startHour,
    options.callingWindow.endHour,
    options.retryLimits.day,
    options.retryLimits.week,
    options.dncrMaxAgeHours,
  ];
  if (expect !== null) {
    args.push(expect);
  }
  const result = statement.run(...args);
  const after = /** @type {any} */ (
    db.prepare('SELECT version FROM tenant_policies WHERE tenant_id = ?').get(tenantId)
  );
  // `changes === 0` on a fenced update means a competing commit moved the
  // version between the read above and the statement; report, don't retry.
  if (expect !== null && result.changes === 0) {
    return { options: null, version: after?.version ?? null, conflict: true };
  }
  return { options, version: after?.version ?? 1, conflict: false };
}

/**
 * Revert the tenant to the statutory defaults (review #197 F3 / cycle-230
 * follow-up): delete the override row. Returns whether a row was removed and
 * the policy that was in force before, so the caller can audit what was lost —
 * a corrupt row is reported rather than silently dropped.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tenantId
 * @param {unknown} [expectedVersion] version fence (review #209 F1), same
 *   `If-Match` semantics as `writeTenantPolicy`; omitted keeps last-write-wins
 * @returns {{ removed: boolean, prior: object | null, violations: string[], conflict: boolean, version: number }}
 */
export function deleteTenantPolicy(db, tenantId, expectedVersion) {
  if (!tenantId) {
    throw new TypeError('deleteTenantPolicy requires tenantId');
  }
  const existing = readTenantPolicy(db, tenantId);
  const expect = parsePolicyVersion(expectedVersion);
  // No override row: the revert's goal is already met, so even a fenced DELETE
  // stays the idempotent 200 no-op.
  if (existing.source === 'default') {
    return { removed: false, prior: null, violations: [], conflict: false, version: 0 };
  }
  if (expect !== null && existing.version !== expect) {
    return {
      removed: false,
      prior: null,
      violations: [],
      conflict: true,
      version: existing.version,
    };
  }
  const sql =
    expect === null
      ? 'DELETE FROM tenant_policies WHERE tenant_id = ?'
      : 'DELETE FROM tenant_policies WHERE tenant_id = ? AND version = ?';
  const args = expect === null ? [tenantId] : [tenantId, expect];
  const result = db.prepare(sql).run(...args);
  // A fenced DELETE that matched nothing lost a race between the read above
  // and the statement: report the now-current version, change nothing.
  if (expect !== null && result.changes === 0) {
    return {
      removed: false,
      prior: null,
      violations: [],
      conflict: true,
      version: readTenantPolicy(db, tenantId).version,
    };
  }
  return {
    removed: result.changes > 0,
    prior: existing.options,
    violations: existing.violations,
    conflict: false,
    version: 0,
  };
}

/** Bound on a history page, so a long-lived tenant cannot return an unbounded body. */
export const HISTORY_LIMIT_DEFAULT = 50;
export const HISTORY_LIMIT_MAX = 200;

/**
 * Append a revision row. Called inside the caller's transaction with the
 * write it describes: a history entry that outlives the write it records, or
 * a write with no entry, would both be misleading. Append-only — reverts
 * delete `tenant_policies`, never these rows.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tenantId
 * @param {{ action: 'updated'|'reverted', policy: object|null, violations?: string[], actorId?: string|null }} entry
 */
export function recordPolicyRevision(db, tenantId, entry) {
  if (!tenantId) {
    throw new TypeError('recordPolicyRevision requires tenantId');
  }
  if (entry?.action !== 'updated' && entry?.action !== 'reverted') {
    throw new RangeError(`unknown policy revision action: ${entry?.action}`);
  }
  db.prepare(
    `INSERT INTO tenant_policy_revisions
       (tenant_id, action, policy_json, violations_json, actor_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    tenantId,
    entry.action,
    entry.policy ? JSON.stringify(entry.policy) : null,
    JSON.stringify(entry.violations ?? []),
    entry.actorId ?? null,
  );
}

/**
 * Newest-first history for one tenant. The stored JSON is re-parsed rather
 * than trusted: a hand-edited snapshot yields `policy: null` plus a parse
 * violation instead of breaking the whole page.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tenantId
 * @param {number|string|undefined} limit
 * @returns {{ entries: object[], limit: number }}
 */
export function readPolicyHistory(db, tenantId, limit) {
  if (!tenantId) {
    throw new TypeError('readPolicyHistory requires tenantId');
  }
  const parsed = Number.parseInt(String(limit ?? ''), 10);
  const bounded = Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), HISTORY_LIMIT_MAX)
    : HISTORY_LIMIT_DEFAULT;
  const rows = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT id, action, policy_json, violations_json, actor_id, created_at
           FROM tenant_policy_revisions
          WHERE tenant_id = ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(tenantId, bounded)
  );
  const entries = rows.map(row => {
    const violations = JSON.parse(row.violations_json);
    let policy = null;
    if (row.policy_json !== null) {
      try {
        policy = JSON.parse(row.policy_json);
      } catch {
        violations.push('stored policy snapshot is not valid JSON');
      }
    }
    return {
      id: row.id,
      action: row.action,
      policy,
      violations,
      actor_id: row.actor_id,
      created_at: row.created_at,
    };
  });
  return { entries, limit: bounded };
}

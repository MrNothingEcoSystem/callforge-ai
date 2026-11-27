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
 * @returns {{ options: object | null, source: 'tenant'|'default', violations: string[] }}
 */
export function readTenantPolicy(db, tenantId) {
  if (!tenantId) {
    throw new TypeError('readTenantPolicy requires tenantId');
  }
  const row = /** @type {any} */ (
    db.prepare('SELECT * FROM tenant_policies WHERE tenant_id = ?').get(tenantId)
  );
  if (!row) {
    return { options: copyPolicyDefaults(), source: 'default', violations: [] };
  }
  const { options, violations } = validatePolicyOptions({
    timeZone: row.time_zone,
    callingWindow: { startHour: row.window_start_hour, endHour: row.window_end_hour },
    retryLimits: { day: row.retry_limit_day, week: row.retry_limit_week },
    dncrMaxAgeHours: row.dncr_max_age_hours,
  });
  return { options, source: 'tenant', violations };
}

/** Upsert after validation; throws on an unusable record. */
export function writeTenantPolicy(db, tenantId, raw) {
  const { options, violations } = validatePolicyOptions(raw);
  if (!options) {
    throw new RangeError(`invalid tenant policy: ${violations.join('; ')}`);
  }
  db.prepare(
    `INSERT INTO tenant_policies
       (tenant_id, time_zone, window_start_hour, window_end_hour,
        retry_limit_day, retry_limit_week, dncr_max_age_hours, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (tenant_id) DO UPDATE SET
       time_zone = excluded.time_zone,
       window_start_hour = excluded.window_start_hour,
       window_end_hour = excluded.window_end_hour,
       retry_limit_day = excluded.retry_limit_day,
       retry_limit_week = excluded.retry_limit_week,
       dncr_max_age_hours = excluded.dncr_max_age_hours,
       updated_at = datetime('now')`,
  ).run(
    tenantId,
    options.timeZone,
    options.callingWindow.startHour,
    options.callingWindow.endHour,
    options.retryLimits.day,
    options.retryLimits.week,
    options.dncrMaxAgeHours,
  );
  return options;
}

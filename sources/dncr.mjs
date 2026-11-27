/**
 * CALLFORGE AI — DNCR check source with a fail-closed TTL cache (TECH-012)
 *
 * R06 forbids marketing dials to numbers on the UAE Do Not Call Registry. The
 * registry itself is reached through an approved provider/carrier portal
 * (EXT-003); this module is the seam, plus the cache that keeps the 24-hour
 * freshness rule honest.
 *
 * Provider contract: `check({ phone, tenantId })` resolves to
 * `{ status: 'clean' | 'listed' | 'unknown', reference }`. Anything else — a
 * throw, a timeout, an unexpected string — is normalised to `unknown`, and
 * `unknown` never upgrades itself to `clean`: the evaluator denies it.
 *
 * The `checked_at` stamp is taken from this side's clock when the answer
 * arrives, not from the provider, so a wrong provider clock cannot buy
 * freshness.
 */
import { POLICY_DEFAULTS } from '../policies/dialEligibility.mjs';

const TTL_HOURS = 24;
const STATUSES = new Set(['clean', 'listed', 'unknown']);
const TIMESTAMP_SQL = 'YYYY-MM-DD HH:MM:SS';

function toDate(value) {
  return value ? new Date(`${String(value).replace(' ', 'T')}Z`) : null;
}

function stamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ provider: { check: (q: {phone: string, tenantId: string}) => Promise<any> | any }, ttlHours?: number, now?: () => Date }} options
 */
export function createCachedDncrSource(
  db,
  { provider, ttlHours = TTL_HOURS, now = () => new Date() },
) {
  if (!provider || typeof provider.check !== 'function') {
    throw new TypeError('createCachedDncrSource requires a provider with check()');
  }
  // Review F1: a cache TTL longer than the evaluator's freshness limit would
  // serve an answer the gate then rejects as stale, so the poll interval is
  // clamped to the policy rather than trusted to the caller.
  const effectiveTtlHours = Math.min(ttlHours, POLICY_DEFAULTS.dncrMaxAgeHours);
  const ttlMs = effectiveTtlHours * 3_600_000;

  /** Cache read; fresh rows are served without touching the provider. */
  function readCache(tenantId, phone) {
    const row = /** @type {any} */ (
      db
        .prepare(
          'SELECT status, checked_at, reference FROM dncr_checks WHERE tenant_id = ? AND phone = ?',
        )
        .get(tenantId, phone)
    );
    if (!row) {
      return null;
    }
    const checkedAt = toDate(row.checked_at);
    if (!checkedAt || Number.isNaN(checkedAt.getTime())) {
      return null;
    }
    const age = now().getTime() - checkedAt.getTime();
    // A future-dated row is treated as stale so it cannot hide a re-check.
    if (age < 0 || age >= ttlMs) {
      return null;
    }
    return { status: row.status, checkedAt, reference: row.reference ?? null, cached: true };
  }

  function writeCache(tenantId, phone, status, checkedAt, reference) {
    db.prepare(
      `INSERT INTO dncr_checks (tenant_id, phone, status, checked_at, reference) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, phone) DO UPDATE SET
         status = excluded.status, checked_at = excluded.checked_at, reference = excluded.reference`,
    ).run(tenantId, phone, status, stamp(checkedAt), reference ?? null);
  }

  /**
   * Resolve the DNCR status for one number. Never throws for a provider
   * outage; the caller gets `unknown` with no fresh stamp.
   */
  async function check({ tenantId, phone }) {
    if (!tenantId || !phone) {
      throw new TypeError('dncr check requires tenantId and phone');
    }
    const hit = readCache(tenantId, phone);
    if (hit) {
      return hit;
    }
    const checkedAt = now();
    let status = 'unknown';
    let reference = null;
    try {
      const answer = await provider.check({ tenantId, phone });
      if (answer && STATUSES.has(answer.status)) {
        status = answer.status;
        reference = answer.reference ?? null;
      } else {
        reference = 'provider_unrecognised_answer';
      }
    } catch (error) {
      reference = `provider_error: ${error?.message ?? 'unknown'}`;
    }
    writeCache(tenantId, phone, status, checkedAt, reference);
    return {
      status,
      checkedAt: status === 'unknown' && reference?.startsWith('provider_error') ? null : checkedAt,
      reference,
      cached: false,
    };
  }

  return { check, ttlHours: effectiveTtlHours, TIMESTAMP_SQL };
}

/** Provider over a fixed fixture map — tests and the demo seed use this. */
export function createStaticDncrProvider(entries = {}) {
  return {
    check({ phone }) {
      if (!(phone in entries)) {
        return { status: 'unknown', reference: 'fixture:absent' };
      }
      const value = entries[phone];
      return typeof value === 'string' ? { status: value } : value;
    },
  };
}

/** Provider that always fails — proves the fail-closed path. */
export function createFailingDncrProvider(message = 'registry unreachable') {
  return {
    check() {
      throw new Error(message);
    },
  };
}

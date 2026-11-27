/**
 * CALLFORGE AI — consent and opt-out source of record (TECH-012)
 *
 * The dial gate previously trusted `contact.consent` exactly as the caller
 * passed it. This module makes consent a durable record: a producer must have
 * recorded consent for a purpose (with evidence) before a marketing dial can
 * pass R05, and a withdrawal is a single row update rather than a caller bug.
 *
 * Boundaries: this is the local store interface, not a portal integration. An
 * external consent system (customer portal, CRM) plugs in by writing here.
 * Unknown purposes deny — the evaluator compares purpose exactly.
 */
import { generateId } from '../store.mjs';

const SCOPES = new Set(['offer', 'global']);

function stamp(value) {
  return (value ?? new Date()).toISOString().slice(0, 19).replace('T', ' ');
}

function revive(row) {
  if (!row) {
    return null;
  }
  return {
    purpose: row.purpose,
    withdrawn: row.status === 'withdrawn',
    grantedAt: row.granted_at ? new Date(`${row.granted_at.replace(' ', 'T')}Z`) : null,
    withdrawnAt: row.withdrawn_at ? new Date(`${row.withdrawn_at.replace(' ', 'T')}Z`) : null,
    evidenceRef: row.evidence_ref ?? null,
  };
}

/**
 * Record (or re-grant) consent for one purpose. Idempotent on
 * (tenant, phone, purpose); a re-grant clears the withdrawal.
 */
export function recordConsent(
  db,
  { tenantId, phone, purpose, evidenceRef = null, grantedAt = null },
) {
  if (!tenantId || !phone || !purpose) {
    throw new TypeError('recordConsent requires tenantId, phone and purpose');
  }
  if (!evidenceRef) {
    // R05 is a consent-record rule: a grant without a pointer to the evidence
    // is a claim the dashboard cannot audit.
    throw new TypeError('recordConsent requires evidenceRef');
  }
  const at = stamp(grantedAt);
  db.prepare(
    `INSERT INTO consents (id, tenant_id, phone, purpose, status, evidence_ref, granted_at, updated_at)
     VALUES (?, ?, ?, ?, 'granted', ?, ?, ?)
     ON CONFLICT (tenant_id, phone, purpose) DO UPDATE SET
       status = 'granted', evidence_ref = excluded.evidence_ref,
       granted_at = excluded.granted_at, withdrawn_at = NULL, updated_at = excluded.updated_at`,
  ).run(generateId(), tenantId, phone, purpose, evidenceRef, at, at);
}

/** Withdraw consent for one purpose. Returns false when nothing was live. */
export function withdrawConsent(db, { tenantId, phone, purpose, withdrawnAt = null }) {
  if (!tenantId || !phone || !purpose) {
    throw new TypeError('withdrawConsent requires tenantId, phone and purpose');
  }
  const at = stamp(withdrawnAt);
  const result = db
    .prepare(
      `UPDATE consents SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
       WHERE tenant_id = ? AND phone = ? AND purpose = ? AND status = 'granted'`,
    )
    .run(at, at, tenantId, phone, purpose);
  return result.changes > 0;
}

/**
 * Latest consent row for the phone. With `purpose` the row must match exactly
 * (a mismatch is the evaluator's r05_consent_purpose_mismatch); without it the
 * most recently updated purpose is returned so the gate can report the
 * mismatch instead of pretending consent is absent.
 */
export function lookupConsent(db, { tenantId, phone, purpose = null }) {
  if (!tenantId || !phone) {
    throw new TypeError('lookupConsent requires tenantId and phone');
  }
  const sql = purpose
    ? 'SELECT * FROM consents WHERE tenant_id = ? AND phone = ? AND purpose = ?'
    : `SELECT * FROM consents WHERE tenant_id = ? AND phone = ?
       ORDER BY updated_at DESC, rowid DESC LIMIT 1`;
  const args = purpose ? [tenantId, phone, purpose] : [tenantId, phone];
  return revive(db.prepare(sql).get(...args));
}

/** Record an offer-scoped or global opt-out (R09). Idempotent. */
export function recordOptOut(db, { tenantId, phone, scope = 'offer', reason = null, at = null }) {
  if (!tenantId || !phone) {
    throw new TypeError('recordOptOut requires tenantId and phone');
  }
  if (!SCOPES.has(scope)) {
    throw new RangeError(`unknown opt-out scope ${scope}`);
  }
  db.prepare(
    `INSERT INTO opt_outs (tenant_id, phone, scope, recorded_at, reason) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, phone, scope) DO UPDATE SET
       recorded_at = excluded.recorded_at, reason = excluded.reason`,
  ).run(tenantId, phone, scope, stamp(at), reason);
}

/**
 * Opt-out flags for the phone. A global opt-out implies the offer one, so a
 * single global row denies every campaign kind.
 */
export function readOptOuts(db, { tenantId, phone }) {
  const rows = db
    .prepare('SELECT scope FROM opt_outs WHERE tenant_id = ? AND phone = ?')
    .all(tenantId, phone);
  const scopes = new Set(rows.map(r => r.scope));
  return {
    optedOut: scopes.has('offer') || scopes.has('global'),
    optOutGlobal: scopes.has('global'),
  };
}

export const CONSENT_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH:MM:SS';

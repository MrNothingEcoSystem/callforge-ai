/**
 * CALLFORGE AI — resolved contact facts for the dial gate (TECH-012)
 *
 * One place that turns (tenant, phone, purpose) into the contact facts the
 * evaluator needs: consent record, opt-outs and a fresh DNCR answer. Everything
 * that can be unknown is left unknown rather than defaulted, because
 * `policies/dialEligibility.mjs` denies unknown.
 */
import { lookupConsent, readOptOuts } from './consent.mjs';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.phone
 * @param {string} [params.purpose]
 * @param {{ check: Function }} [params.dncr] cached DNCR source; absent → unknown
 * @param {Date} [params.now]
 */
export async function resolveContactFacts(
  db,
  { tenantId, phone, purpose, dncr, now = new Date() },
) {
  if (!tenantId || !phone) {
    throw new TypeError('resolveContactFacts requires tenantId and phone');
  }
  const optOuts = readOptOuts(db, { tenantId, phone });
  // Exact purpose first: an exact hit is the only thing the evaluator accepts.
  // Falling back to the latest row for another purpose lets it report a
  // mismatch (r05_consent_purpose_mismatch) instead of a bare absence.
  const consent = purpose
    ? (lookupConsent(db, { tenantId, phone, purpose }) ?? lookupConsent(db, { tenantId, phone }))
    : lookupConsent(db, { tenantId, phone });

  let dncrStatus = 'unknown';
  let dncrCheckedAt = null;
  let dncrReference = 'no_dncr_source';
  if (dncr) {
    const answer = await dncr.check({ tenantId, phone });
    dncrStatus = answer.status;
    dncrCheckedAt = answer.checkedAt ?? null;
    dncrReference = answer.reference ?? null;
  }

  return {
    phone,
    consent,
    dncrStatus,
    dncrCheckedAt,
    dncrReference,
    consentEvidenceRef: consent?.evidenceRef ?? null,
    ...optOuts,
    resolvedBy: 'sources',
    resolvedAt: now.toISOString(),
  };
}

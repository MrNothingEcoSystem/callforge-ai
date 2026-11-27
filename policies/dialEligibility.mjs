/**
 * CALLFORGE AI — M04 pre-dial eligibility policy (fail-closed)
 *
 * Pure evaluator for the M04 human-approval gates G1–G5 and the underlying
 * Res.56/PDPL rules in management/UAE_COMPLIANCE_REGISTER.md. No DB, no clock
 * sniffing: the caller supplies `now` and the tenant/contact facts, so the
 * decision is reproducible and unit-testable.
 *
 * Design rule: every gate is fail-closed. Missing, stale or unrecognised input
 * denies the dial and returns a machine-readable reason instead of a default
 * allow. All reasons are collected (no short-circuit) so a compliance dashboard
 * can show the complete block picture, and each reason carries its Res.57
 * penalty tier so the dashboard can prioritise.
 *
 * Scope applied by campaign kind:
 *   marketing            → R01 G1, R03 G3, R05/R11 G2, R06, R08 G4, R09, R10 G5
 *   consumer_requested   → R03 G3, R06 (call-back etiquette), R08 G4, R09, R10 G5
 *   transactional        → R03 G3, R09 (global opt-out only)
 *
 * Not legal advice: thresholds marked LEGAL-REVIEW in the register are
 * expressed as policy options, not hard-coded law.
 */

const DEFAULT_TIME_ZONE = 'Asia/Dubai';
const CALLING_WINDOW = { startHour: 9, endHour: 18 };
// Art.5(5) allows 1 callback/day and 2/week, so the ceilings count *calls*:
// the initial attempt plus its callbacks (2/day, 3/7d). Reaching the ceiling denies.
const RETRY_LIMITS = { day: 2, week: 3 };
const DNCR_MAX_AGE_HOURS = 24;
const UNANSWERED_OUTCOMES = new Set(['no_answer', 'callback', 'ended_unanswered']);

/** Rule catalogue: id → penalty tier (Res.57) and human label. */
export const RULES = {
  R01: { label: 'competent-authority approval', tier: 'no approval 75k/100k/150k' },
  R03: { label: 'CLI bound to licence inventory', tier: 'unregistered CLI 25k/50k/75k' },
  R05: { label: 'lawful basis / consent record', tier: 'data trading/consent 50k/75k/150k' },
  R06: { label: 'DNCR check', tier: 'DNCR 50k/75k/150k' },
  R08: { label: 'calling window 09:00–18:00', tier: 'per Res.57 tier 1–3' },
  R09: { label: 'opt-out honouring', tier: 'per Res.57 tier 1–3' },
  R10: { label: 'retry ceiling', tier: 'per Res.57 tier 1–3' },
};

const E164 = /^\+[1-9]\d{7,14}$/;

function reason(code, rule, detail) {
  return { code, rule, tier: RULES[rule]?.tier ?? 'unknown', detail };
}

function isDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Local wall-clock hour in `timeZone`; throws for an unusable time zone. */
export function localHour(date, timeZone = DEFAULT_TIME_ZONE) {
  if (!isDate(date)) {
    throw new TypeError('localHour requires a valid Date');
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new RangeError('localHour could not resolve a wall-clock time');
  }
  return { hour, minute };
}

function attemptCount(attempts, outcomeFilter, windowMs, now) {
  return attempts.filter(a => {
    if (!isDate(a?.at)) {
      return false;
    }
    if (outcomeFilter && !outcomeFilter.has(a.outcome)) {
      return false;
    }
    const age = now.getTime() - a.at.getTime();
    return age >= 0 && age < windowMs;
  }).length;
}

function checkApproval(policy, now, reasons) {
  if (policy.licensed !== true) {
    reasons.push(
      reason('r01_no_licence', 'R01', 'tenant has no recorded competent-authority licence'),
    );
    return;
  }
  if (!policy.approvalRef) {
    reasons.push(
      reason('r01_approval_missing', 'R01', 'no approval reference on the tenant record'),
    );
  }
  if (!isDate(policy.approvalExpiresAt)) {
    reasons.push(
      reason('r01_approval_expiry_unknown', 'R01', 'approval expiry missing or unparsable'),
    );
  } else if (policy.approvalExpiresAt.getTime() <= now.getTime()) {
    reasons.push(
      reason(
        'r01_approval_expired',
        'R01',
        `approval expired ${policy.approvalExpiresAt.toISOString()}`,
      ),
    );
  }
}

function checkCli(policy, campaign, reasons) {
  const inventory = policy.cliInventory ?? [];
  const cli = campaign.cli;
  if (!cli) {
    reasons.push(reason('r03_cli_missing', 'R03', 'campaign has no CLI assigned'));
  } else if (!inventory.includes(cli)) {
    reasons.push(
      reason('r03_cli_not_bound', 'R03', `CLI ${cli} is not in the licence-bound inventory`),
    );
  }
}

function checkConsent(contact, campaign, reasons) {
  const consent = contact.consent;
  if (!consent || consent.withdrawn === true) {
    reasons.push(reason('r05_consent_missing', 'R05', 'no live consent record for this contact'));
    return;
  }
  if (!campaign.purpose) {
    reasons.push(
      reason(
        'r05_purpose_missing',
        'R05',
        'marketing campaign has no purpose to match against consent or the opener',
      ),
    );
    return;
  }
  if (consent.purpose !== campaign.purpose) {
    reasons.push(
      reason(
        'r05_consent_purpose_mismatch',
        'R05',
        `consent purpose ${consent.purpose} ≠ campaign purpose ${campaign.purpose}`,
      ),
    );
  }
}

function checkDncr(contact, now, reasons) {
  const status = contact.dncrStatus;
  if (status === 'listed') {
    reasons.push(reason('r06_dncr_listed', 'R06', 'contact is on the DNCR'));
    return;
  }
  if (status !== 'clean') {
    reasons.push(reason('r06_dncr_unknown', 'R06', `DNCR status is ${status ?? 'absent'}`));
    return;
  }
  if (!isDate(contact.dncrCheckedAt)) {
    reasons.push(reason('r06_dncr_stale', 'R06', 'DNCR check timestamp missing'));
    return;
  }
  const ageHours = (now.getTime() - contact.dncrCheckedAt.getTime()) / 3_600_000;
  if (ageHours < 0 || ageHours > DNCR_MAX_AGE_HOURS) {
    reasons.push(reason('r06_dncr_stale', 'R06', `DNCR check is ${ageHours.toFixed(1)}h old`));
  }
}

function checkWindow(now, timeZone, reasons) {
  let hour;
  let minute;
  try {
    ({ hour, minute } = localHour(now, timeZone));
  } catch {
    reasons.push(
      reason('r08_time_zone_unknown', 'R08', `calling window unresolvable for ${timeZone}`),
    );
    return;
  }
  const before = hour < CALLING_WINDOW.startHour || (hour === CALLING_WINDOW.endHour && minute > 0);
  const after = hour >= CALLING_WINDOW.endHour;
  if (before || after) {
    reasons.push(
      reason(
        'r08_outside_window',
        'R08',
        `local time ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} is outside 09:00–18:00`,
      ),
    );
  }
}

/**
 * Evaluate whether one dial may proceed.
 *
 * @param {object} ctx
 * @param {Date} ctx.now
 * @param {object} ctx.campaign  { kind: 'marketing'|'consumer_requested'|'transactional', cli, purpose }
 * @param {object} ctx.contact   { phone, consent?, dncrStatus?, dncrCheckedAt?, optedOut?, optOutGlobal? }
 * @param {object} ctx.policy    { licensed, approvalRef, approvalExpiresAt, cliInventory }
 * @param {Array<{at: Date, outcome: string}>} [ctx.attempts]
 * @param {string} [ctx.timeZone='Asia/Dubai']
 * @returns {{ allowed: boolean, reasons: Array<object>, warnings: string[] }}
 */
export function evaluateDial(ctx = {}) {
  const reasons = [];
  const warnings = [];
  const { now, campaign, contact, policy } = ctx;
  const attempts = Array.isArray(ctx.attempts) ? ctx.attempts : [];
  const timeZone = ctx.timeZone ?? DEFAULT_TIME_ZONE;

  if (!isDate(now) || !campaign || !contact || !policy) {
    return {
      allowed: false,
      reasons: [
        reason('invalid_context', 'R01', 'now, campaign, contact and policy are all required'),
      ],
      warnings,
    };
  }
  if (!E164.test(contact.phone ?? '')) {
    reasons.push(
      reason('r03_phone_invalid', 'R03', `contact phone ${contact.phone ?? '(none)'} is not E.164`),
    );
  }

  const kind = campaign.kind;
  if (!['marketing', 'consumer_requested', 'transactional'].includes(kind)) {
    reasons.push(
      reason('r05_kind_unknown', 'R05', `campaign kind ${kind ?? '(none)'} is not classified`),
    );
  }

  checkCli(policy, campaign, reasons);

  if (kind === 'marketing' || kind === 'consumer_requested') {
    checkWindow(now, timeZone, reasons);
  }

  if (kind === 'marketing') {
    checkApproval(policy, now, reasons);
    checkConsent(contact, campaign, reasons);
    checkDncr(contact, now, reasons);
    if (contact.optOutGlobal) {
      reasons.push(reason('r09_global_opt_out', 'R09', 'contact is globally opted out'));
    }
    if (contact.optedOut) {
      reasons.push(reason('r09_offer_refused', 'R09', 'contact refused this offer'));
    }
  } else if (kind === 'consumer_requested') {
    checkDncr(contact, now, reasons);
    if (contact.optOutGlobal) {
      reasons.push(reason('r09_global_opt_out', 'R09', 'contact is globally opted out'));
    }
  } else if (kind === 'transactional' && contact.optOutGlobal) {
    reasons.push(reason('r09_global_opt_out', 'R09', 'contact is globally opted out'));
  }

  if (kind !== 'transactional') {
    const day = attemptCount(attempts, UNANSWERED_OUTCOMES, 86_400_000, now);
    const week = attemptCount(attempts, UNANSWERED_OUTCOMES, 7 * 86_400_000, now);
    if (day >= RETRY_LIMITS.day) {
      reasons.push(reason('r10_retry_day', 'R10', `${day} unanswered call(s) in the last 24h`));
    }
    if (week >= RETRY_LIMITS.week) {
      reasons.push(reason('r10_retry_week', 'R10', `${week} unanswered call(s) in the last 7d`));
    }
  }

  return { allowed: reasons.length === 0, reasons, warnings };
}

export const POLICY_DEFAULTS = Object.freeze({
  timeZone: DEFAULT_TIME_ZONE,
  callingWindow: CALLING_WINDOW,
  retryLimits: RETRY_LIMITS,
  dncrMaxAgeHours: DNCR_MAX_AGE_HOURS,
});

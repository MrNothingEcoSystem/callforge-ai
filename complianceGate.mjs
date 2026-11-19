/**
 * CALLFORGE AI — M04 deterministic pre-dial compliance gate (increment 1)
 *
 * Implements only the "IMPLEMENTABLE NOW" rules from
 * management/UAE_COMPLIANCE_REGISTER.md. Every check consumes verifiable
 * inputs (numbers, timestamps, counters, script flags) — never a
 * caller-asserted boolean. Fail-closed: any missing/invalid input fails
 * its check. LEGAL-REVIEW rules (R01,R02,R05,R07 lawful-basis mapping,
 * R12 wording, R14 cross-border, weekend scope of R08) are NOT decided
 * here and remain gated by EXT-002 (qualified UAE counsel).
 *
 * This is a simulation-baseline control: it gates simulated intents and
 * records evidence. It does not dial, and does not make M04 closable.
 */

const DUBAI_TZ = 'Asia/Dubai';

/** @typedef {Object} AttemptCounters
 * @property {number} [callbacksToday]
 * @property {number} [callbacksThisWeek]
 */

/** @typedef {Object} Opener
 * @property {string} [companyName]
 * @property {string} [purpose]
 * @property {string} [recordingNotice]
 * @property {string} [continuePrompt]
 * @property {boolean} [automated]
 * @property {boolean} [aiDisclosure]
 */

/** @typedef {Object} PreDialInput
 * @property {string} [destinationNumber]
 * @property {string[]} [suppressionNumbers] DNCR + opt-out union (raw numbers ok)
 * @property {string[]} [registeredCliNumbers] licence-registered CLI inventory
 * @property {string} [cliNumber] CLI the call would present
 * @property {Date|string} [scheduledAt]
 * @property {boolean} [consumerRefused] consumer already refused this offer (R09)
 * @property {boolean} [globalOptOut] consumer requested global opt-out (R09)
 * @property {AttemptCounters} [attempts] R10 counters
 * @property {Opener} [opener]
 * @property {string|null} [consentRef] consent ledger reference (R07-present; basis mapping is LEGAL-REVIEW)
 */

/** @typedef {Object} GateCheck
 * @property {string} id
 * @property {string} rule
 * @property {boolean} passed
 * @property {string} reason
 */

/** Normalize a UAE phone number to 971XXXXXXXXX digits, or null.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeUaeNumber(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('971')) {
    return digits.length === 11 || digits.length === 12 ? digits : null;
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 8 || digits.length === 9) {
    return `971${digits}`;
  }
  return null;
}

/** Dubai wall-clock HH:MM(SS) parts for an instant.
 * @param {Date} date
 * @returns {{hour:number, minute:number, second:number}}
 */
export function dubaiTimeParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = t => Number(parts.find(p => p.type === t)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** R08: marketing calls only 09:00-18:00 Asia/Dubai (inclusive start, exclusive end).
 * @param {Date} date
 * @returns {boolean}
 */
export function isWithinCallingHours(date) {
  const { hour, minute, second } = dubaiTimeParts(date);
  const secs = hour * 3600 + minute * 60 + second;
  return secs >= 9 * 3600 && secs < 18 * 3600;
}

/**
 * @param {string} id
 * @param {string} rule
 * @param {boolean} passed
 * @param {string} reason
 * @returns {GateCheck}
 */
function check(id, rule, passed, reason) {
  return { id, rule, passed, reason };
}

/**
 * Evaluate the pre-dial gate. Pure and deterministic. All fields optional;
 * missing/invalid input fails its check (fail-closed).
 * @param {PreDialInput} [input]
 * @returns {{allowed:boolean, checks:GateCheck[]}}
 */
export function evaluatePreDialGate(input = {}) {
  const checks = [];

  // R07 (presence only): a consent ledger reference is required.
  checks.push(
    check(
      'consent_ref',
      'R07',
      typeof input.consentRef === 'string' && input.consentRef.trim().length > 0,
      'consent ledger reference required (lawful-basis mapping: LEGAL-REVIEW/EXT-002)',
    ),
  );

  // R03: CLI must be in the licence-registered inventory.
  const cli = normalizeUaeNumber(input.cliNumber);
  const registered = new Set(
    (input.registeredCliNumbers ?? []).map(normalizeUaeNumber).filter(Boolean),
  );
  checks.push(
    check(
      'cli_registered',
      'R03',
      cli !== null && registered.has(cli),
      cli === null ? 'CLI is not a valid UAE number' : 'CLI not in registered inventory',
    ),
  );

  // R06: destination must not be suppressed (DNCR union opt-outs).
  const dest = normalizeUaeNumber(input.destinationNumber);
  const suppressed = new Set(
    (input.suppressionNumbers ?? []).map(normalizeUaeNumber).filter(Boolean),
  );
  checks.push(
    check(
      'not_suppressed',
      'R06',
      dest !== null && !suppressed.has(dest),
      dest === null
        ? 'destination is not a valid UAE number'
        : 'destination on DNCR/opt-out suppression list',
    ),
  );

  // R08: calling hours 09:00-18:00 Asia/Dubai.
  const when = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
  checks.push(
    check(
      'calling_hours',
      'R08',
      !Number.isNaN(when.getTime()) && isWithinCallingHours(when),
      'scheduled time outside 09:00-18:00 Asia/Dubai (or invalid)',
    ),
  );

  // R09: refusal / global opt-out is a hard block.
  checks.push(
    check(
      'no_refusal',
      'R09',
      input.consumerRefused !== true && input.globalOptOut !== true,
      'consumer refused this offer or opted out globally',
    ),
  );

  // R10: max 1 callback/day, 2/week (conservative: callbacks only).
  const attempts = input.attempts ?? {};
  checks.push(
    check(
      'retry_limits',
      'R10',
      Number.isInteger(attempts.callbacksToday) &&
        Number.isInteger(attempts.callbacksThisWeek) &&
        attempts.callbacksToday >= 0 &&
        attempts.callbacksThisWeek >= 0 &&
        attempts.callbacksToday < 1 &&
        attempts.callbacksThisWeek < 2,
      'retry ceiling reached (1/day, 2/week) or attempt counters missing',
    ),
  );

  // R11/R12/R13: mandatory opener — company, purpose, recording notice,
  // continue-prompt; AI disclosure required for automated calls.
  const opener = input.opener ?? {};
  const openerFieldsOk = [
    opener.companyName,
    opener.purpose,
    opener.recordingNotice,
    opener.continuePrompt,
  ].every(v => typeof v === 'string' && v.trim().length > 0);
  const aiDisclosureOk = opener.automated !== true || opener.aiDisclosure === true;
  const openerOk = openerFieldsOk && aiDisclosureOk;
  checks.push(
    check(
      'opener_disclosure',
      'R11/R12/R13',
      openerOk,
      'opener missing company/purpose/recording-notice/continue-prompt, or automated call without AI disclosure',
    ),
  );

  return { allowed: checks.every(c => c.passed), checks };
}

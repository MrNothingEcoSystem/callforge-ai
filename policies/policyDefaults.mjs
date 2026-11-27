/**
 * CALLFORGE AI — statutory dial-policy defaults (review TECH-013 F6/F7)
 *
 * Neutral module so `dialEligibility.mjs` (evaluator) and `tenantPolicy.mjs`
 * (record) do not import each other. Values are Res.56/PDPL statutory defaults
 * from management/UAE_COMPLIANCE_REGISTER.md; a tenant record may override the
 * numeric knobs, and the gate must deny — never widen — when a record is bad.
 *
 * Frozen all the way down (F7): a caller that mutates a snapshot it was handed
 * must not mutate the module default, so `copyPolicyDefaults()` returns a fresh
 * nested copy and nothing else is exported by reference.
 */

const DEFAULT_TIME_ZONE = 'Asia/Dubai';
const CALLING_WINDOW = Object.freeze({ startHour: 9, endHour: 18 });
// Art.5(5) allows 1 callback/day and 2/week, so the ceilings count *calls*:
// the initial attempt plus its callbacks (2/day, 3/7d). Reaching the ceiling denies.
const RETRY_LIMITS = Object.freeze({ day: 2, week: 3 });
const DNCR_MAX_AGE_HOURS = 24;

export { DEFAULT_TIME_ZONE, CALLING_WINDOW, RETRY_LIMITS, DNCR_MAX_AGE_HOURS };

export const POLICY_DEFAULTS = Object.freeze({
  timeZone: DEFAULT_TIME_ZONE,
  callingWindow: CALLING_WINDOW,
  retryLimits: RETRY_LIMITS,
  dncrMaxAgeHours: DNCR_MAX_AGE_HOURS,
});

/** A fresh, structurally independent copy of the statutory defaults. */
export function copyPolicyDefaults() {
  return {
    timeZone: DEFAULT_TIME_ZONE,
    callingWindow: { ...CALLING_WINDOW },
    retryLimits: { ...RETRY_LIMITS },
    dncrMaxAgeHours: DNCR_MAX_AGE_HOURS,
  };
}

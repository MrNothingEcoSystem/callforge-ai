import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POLICY_DEFAULTS, copyPolicyDefaults } from '../policies/policyDefaults.mjs';

const source = file => readFileSync(new URL(`../policies/${file}`, import.meta.url), 'utf8');

describe('policy defaults module (review TECH-013 F6/F7)', () => {
  it('is the single home of the statutory defaults (no import cycle)', () => {
    expect(source('dialEligibility.mjs')).toMatch(/from '\.\/policyDefaults\.mjs'/);
    expect(source('tenantPolicy.mjs')).toMatch(/from '\.\/policyDefaults\.mjs'/);
    expect(source('tenantPolicy.mjs')).not.toMatch(/from '\.\/dialEligibility\.mjs'/);
    expect(source('dialEligibility.mjs')).not.toMatch(
      /from '\.\/tenantPolicy\.mjs'.*POLICY_DEFAULTS/,
    );
  });

  it('still re-exports POLICY_DEFAULTS from the evaluator for existing callers', async () => {
    const evaluator = await import('../policies/dialEligibility.mjs');
    expect(evaluator.POLICY_DEFAULTS).toBe(POLICY_DEFAULTS);
  });

  it('freezes the defaults all the way down and copies them independently', () => {
    expect(Object.isFrozen(POLICY_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(POLICY_DEFAULTS.callingWindow)).toBe(true);
    expect(Object.isFrozen(POLICY_DEFAULTS.retryLimits)).toBe(true);
    const a = copyPolicyDefaults();
    const b = copyPolicyDefaults();
    a.callingWindow.startHour = 3;
    a.retryLimits.day = 9;
    expect(POLICY_DEFAULTS.callingWindow.startHour).toBe(9);
    expect(POLICY_DEFAULTS.retryLimits.day).toBe(2);
    expect(b.callingWindow.startHour).toBe(9);
    expect(b).not.toBe(a);
  });
});

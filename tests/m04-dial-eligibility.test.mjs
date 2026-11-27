import { describe, expect, it } from 'vitest';
import { evaluateDial, localHour, POLICY_DEFAULTS } from '../policies/dialEligibility.mjs';

// M04 control tests: every gate must deny on absence/ambiguity, allow only on a
// fully clean context. Dubai is a fixed UTC+4 zone, so wall-clock fixtures are
// written as UTC instants: 09:00 Dubai = 05:00Z, 18:00 Dubai = 14:00Z.

const NOW = new Date('2026-11-26T05:00:00Z'); // 09:00 Dubai, first instant of the window

function policy(overrides = {}) {
  return {
    licensed: true,
    approvalRef: 'MOE-2026-0412',
    approvalExpiresAt: new Date('2027-01-01T00:00:00Z'),
    cliInventory: ['+97142223344'],
    ...overrides,
  };
}

function contact(overrides = {}) {
  return {
    phone: '+971501234567',
    consent: { purpose: 'renewal', withdrawn: false },
    dncrStatus: 'clean',
    dncrCheckedAt: new Date(NOW.getTime() - 3_600_000),
    optedOut: false,
    optOutGlobal: false,
    ...overrides,
  };
}

function campaign(overrides = {}) {
  return { kind: 'marketing', cli: '+97142223344', purpose: 'renewal', ...overrides };
}

const evaluate = (overrides = {}) =>
  evaluateDial({
    now: NOW,
    campaign: campaign(),
    contact: contact(),
    policy: policy(),
    ...overrides,
  });

const codes = result => result.reasons.map(r => r.code);

describe('evaluateDial — allow path', () => {
  it('allows a clean marketing dial inside the window', () => {
    const result = evaluate();
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('carries no warnings on a fully specified campaign', () => {
    expect(evaluate().warnings).toEqual([]);
  });
});

describe('evaluateDial — fail-closed context', () => {
  it('denies when required context is missing', () => {
    expect(evaluateDial({}).allowed).toBe(false);
    expect(codes(evaluateDial({}))).toContain('invalid_context');
  });

  it('denies an invalid `now`', () => {
    expect(codes(evaluate({ now: new Date('nope') }))).toContain('invalid_context');
  });

  it('denies a non-E.164 phone', () => {
    expect(codes(evaluate({ contact: contact({ phone: '0501234567' }) }))).toContain(
      'r03_phone_invalid',
    );
  });

  it('denies an unclassified campaign kind', () => {
    expect(codes(evaluate({ campaign: campaign({ kind: 'outbound' }) }))).toContain(
      'r05_kind_unknown',
    );
  });
});

describe('evaluateDial — R01 competent-authority approval (G1)', () => {
  it('denies marketing without a licence', () => {
    expect(codes(evaluate({ policy: policy({ licensed: false }) }))).toContain('r01_no_licence');
  });

  it('denies marketing without an approval reference', () => {
    expect(codes(evaluate({ policy: policy({ approvalRef: '' }) }))).toContain(
      'r01_approval_missing',
    );
  });

  it('denies an expired approval', () => {
    const result = evaluate({
      policy: policy({ approvalExpiresAt: new Date('2026-11-01T00:00:00Z') }),
    });
    expect(codes(result)).toContain('r01_approval_expired');
  });

  it('denies an unparsable approval expiry', () => {
    expect(codes(evaluate({ policy: policy({ approvalExpiresAt: null }) }))).toContain(
      'r01_approval_expiry_unknown',
    );
  });

  it('does not require approval for transactional dials', () => {
    const result = evaluate({
      campaign: campaign({ kind: 'transactional' }),
      policy: policy({ licensed: false, approvalRef: '' }),
    });
    expect(result.allowed).toBe(true);
  });
});

describe('evaluateDial — R03 CLI binding (G3)', () => {
  it('denies a CLI outside the licence inventory', () => {
    expect(codes(evaluate({ campaign: campaign({ cli: '+971509998888' }) }))).toContain(
      'r03_cli_not_bound',
    );
  });

  it('denies a campaign with no CLI', () => {
    expect(codes(evaluate({ campaign: campaign({ cli: undefined }) }))).toContain(
      'r03_cli_missing',
    );
  });

  it('denies a CLI for transactional dials too', () => {
    const result = evaluate({ campaign: campaign({ kind: 'transactional', cli: undefined }) });
    expect(codes(result)).toContain('r03_cli_missing');
  });
});

describe('evaluateDial — R05 consent (G2 groundwork)', () => {
  it('denies marketing with no consent record', () => {
    expect(codes(evaluate({ contact: contact({ consent: undefined }) }))).toContain(
      'r05_consent_missing',
    );
  });

  it('denies marketing after consent withdrawal', () => {
    const result = evaluate({
      contact: contact({ consent: { purpose: 'renewal', withdrawn: true } }),
    });
    expect(codes(result)).toContain('r05_consent_missing');
  });

  it('denies a contact whose consent exists but carries no purpose', () => {
    expect(codes(evaluate({ contact: contact({ consent: { withdrawn: false } }) }))).toContain(
      'r05_consent_purpose_mismatch',
    );
  });

  it('denies a consent purpose that does not match the campaign', () => {
    const result = evaluate({ contact: contact({ consent: { purpose: 'onboarding' } }) });
    expect(codes(result)).toContain('r05_consent_purpose_mismatch');
  });
});

describe('evaluateDial — R06 DNCR (G2)', () => {
  it('denies a DNCR-listed contact', () => {
    expect(codes(evaluate({ contact: contact({ dncrStatus: 'listed' }) }))).toContain(
      'r06_dncr_listed',
    );
  });

  it('denies an unknown DNCR status rather than assuming clean', () => {
    expect(codes(evaluate({ contact: contact({ dncrStatus: undefined }) }))).toContain(
      'r06_dncr_unknown',
    );
  });

  it('denies a DNCR check older than 24h', () => {
    const result = evaluate({
      contact: contact({ dncrCheckedAt: new Date('2026-11-25T04:00:00Z') }),
    });
    expect(codes(result)).toContain('r06_dncr_stale');
  });

  it('denies a DNCR check with no timestamp', () => {
    expect(codes(evaluate({ contact: contact({ dncrCheckedAt: undefined }) }))).toContain(
      'r06_dncr_stale',
    );
  });

  it('checks DNCR for consumer-requested calls as well', () => {
    const result = evaluate({
      campaign: campaign({ kind: 'consumer_requested' }),
      contact: contact({ dncrStatus: 'listed' }),
    });
    expect(codes(result)).toContain('r06_dncr_listed');
  });
});

describe('evaluateDial — R08 calling window (G4)', () => {
  it('denies 08:59 Dubai', () => {
    const result = evaluate({
      now: new Date('2026-11-26T04:59:00Z'),
      contact: contact({ dncrCheckedAt: new Date('2026-11-26T04:00:00Z') }),
    });
    expect(codes(result)).toContain('r08_outside_window');
  });

  it('allows 09:00 Dubai exactly', () => {
    expect(evaluate().allowed).toBe(true);
  });

  it('allows 17:59 Dubai', () => {
    expect(evaluate({ now: new Date('2026-11-26T13:59:00Z') }).allowed).toBe(true);
  });

  it('denies 18:00 Dubai exactly (conservative boundary)', () => {
    expect(codes(evaluate({ now: new Date('2026-11-26T14:00:00Z') }))).toContain(
      'r08_outside_window',
    );
  });

  it('ignores the window for transactional dials', () => {
    const result = evaluate({
      now: new Date('2026-11-26T23:30:00Z'),
      campaign: campaign({ kind: 'transactional' }),
    });
    expect(result.allowed).toBe(true);
  });

  it('resolves the hour in the configured zone, not the host zone', () => {
    // 20:00Z is 20:00 UTC (outside) but 00:00 Dubai (also outside); 01:00Z next day is
    // outside UTC and 05:00 Dubai (also outside). Use 20:00Z under UTC vs Dubai asymmetry:
    // 15:00Z is inside in both, so pick 20:30Z where UTC hour 20 is outside and Dubai is 00:30.
    const outsideUtc = evaluate({ now: new Date('2026-11-26T20:30:00Z'), timeZone: 'UTC' });
    expect(codes(outsideUtc)).toContain('r08_outside_window');
    expect(localHour(new Date('2026-11-26T20:30:00Z'), 'UTC')).toEqual({ hour: 20, minute: 30 });
  });

  it('fails closed on an unusable time zone', () => {
    expect(codes(evaluate({ timeZone: 'Mars/Olympus' }))).toContain('r08_time_zone_unknown');
  });
});

describe('evaluateDial — R09 opt-out', () => {
  it('denies a globally opted-out contact', () => {
    expect(codes(evaluate({ contact: contact({ optOutGlobal: true }) }))).toContain(
      'r09_global_opt_out',
    );
  });

  it('denies a refused offer', () => {
    expect(codes(evaluate({ contact: contact({ optedOut: true }) }))).toContain(
      'r09_offer_refused',
    );
  });

  it('honours the global opt-out on transactional dials', () => {
    const result = evaluate({
      campaign: campaign({ kind: 'transactional' }),
      contact: contact({ optOutGlobal: true }),
    });
    expect(codes(result)).toContain('r09_global_opt_out');
  });
});

describe('evaluateDial — R10 retry ceiling (G5)', () => {
  const at = hoursAgo => ({
    at: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    outcome: 'no_answer',
  });

  it('allows the single permitted callback within 24h', () => {
    expect(evaluate({ attempts: [at(2)] }).allowed).toBe(true);
  });

  it('denies a third call within 24h', () => {
    expect(codes(evaluate({ attempts: [at(2), at(6)] }))).toContain('r10_retry_day');
  });

  it('denies a fourth call within 7 days', () => {
    const result = evaluate({ attempts: [at(40), at(80), at(120)] });
    expect(codes(result)).toContain('r10_retry_week');
  });

  it('allows again once both windows are clear', () => {
    expect(evaluate({ attempts: [at(40), at(200), at(300)] }).allowed).toBe(true);
  });

  it('ignores non-unanswered outcomes for the ceiling', () => {
    const connected = { at: new Date(NOW.getTime() - 3_600_000), outcome: 'connected' };
    expect(evaluate({ attempts: [connected] }).allowed).toBe(true);
  });

  it('ignores malformed attempt timestamps', () => {
    expect(evaluate({ attempts: [{ at: 'yesterday', outcome: 'no_answer' }] }).allowed).toBe(true);
  });
});

describe('evaluateDial — reporting shape', () => {
  it('collects every blocking reason instead of short-circuiting', () => {
    const result = evaluate({
      contact: contact({ dncrStatus: 'listed', optOutGlobal: true, consent: undefined }),
      campaign: campaign({ cli: '+971500000000' }),
      policy: policy({ licensed: false }),
    });
    expect(result.allowed).toBe(false);
    expect(new Set(codes(result)).size).toBeGreaterThanOrEqual(5);
  });

  it('carries the rule id and penalty tier on each reason', () => {
    const [first] = evaluate({ contact: contact({ dncrStatus: 'listed' }) }).reasons;
    expect(first.rule).toBe('R06');
    expect(first.tier).toMatch(/DNCR/);
  });

  it('denies a marketing campaign with no purpose to disclose', () => {
    expect(codes(evaluate({ campaign: campaign({ purpose: undefined }) }))).toContain(
      'r05_purpose_missing',
    );
  });

  it('exposes its defaults for the dashboard', () => {
    expect(POLICY_DEFAULTS.callingWindow).toEqual({ startHour: 9, endHour: 18 });
    expect(POLICY_DEFAULTS.dncrMaxAgeHours).toBe(24);
  });
});

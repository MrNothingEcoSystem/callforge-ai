/**
 * M04 increment 1 — deterministic pre-dial compliance gate.
 * Covers only IMPLEMENTABLE NOW rules (UAE_COMPLIANCE_REGISTER.md).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluatePreDialGate,
  normalizeUaeNumber,
  isWithinCallingHours,
} from '../complianceGate.mjs';

const validInput = () => ({
  destinationNumber: '+971 50 123 4567',
  suppressionNumbers: ['+971 50 999 9999'],
  registeredCliNumbers: ['+971 4 123 4567'],
  cliNumber: '041234567',
  scheduledAt: '2026-11-19T06:00:00Z', // 10:00 Asia/Dubai
  consumerRefused: false,
  globalOptOut: false,
  attempts: { callbacksToday: 0, callbacksThisWeek: 0 },
  opener: {
    companyName: 'Acme LLC',
    purpose: 'Product offer',
    recordingNotice: 'This call is recorded',
    continuePrompt: 'May we continue?',
    automated: true,
    aiDisclosure: true,
  },
  consentRef: 'consent:ledger#42',
});

describe('normalizeUaeNumber', () => {
  it('normalizes +, bare, and trunk-0 formats to 971…', () => {
    expect(normalizeUaeNumber('+971 50 123 4567')).toBe('971501234567');
    expect(normalizeUaeNumber('0501234567')).toBe('971501234567');
    expect(normalizeUaeNumber('00971501234567')).toBe('971501234567');
  });
  it('rejects non-UAE / non-string input', () => {
    expect(normalizeUaeNumber('+1 555 010 2030')).toBeNull();
    expect(normalizeUaeNumber(undefined)).toBeNull();
    expect(normalizeUaeNumber('')).toBeNull();
  });
});

describe('isWithinCallingHours (Asia/Dubai 09:00-18:00)', () => {
  it('accepts 10:00 and 17:59 Dubai, rejects 08:59, 18:00, and night', () => {
    expect(isWithinCallingHours(new Date('2026-11-19T06:00:00Z'))).toBe(true); // 10:00
    expect(isWithinCallingHours(new Date('2026-11-19T13:59:59Z'))).toBe(true); // 17:59:59
    expect(isWithinCallingHours(new Date('2026-11-19T04:59:59Z'))).toBe(false); // 08:59:59
    expect(isWithinCallingHours(new Date('2026-11-19T14:00:00Z'))).toBe(false); // 18:00
    expect(isWithinCallingHours(new Date('2026-11-19T20:00:00Z'))).toBe(false); // 00:00
  });
});

describe('evaluatePreDialGate', () => {
  it('allows a fully compliant intent', () => {
    const result = evaluatePreDialGate(validInput());
    expect(result.allowed).toBe(true);
    expect(result.checks.every(c => c.passed)).toBe(true);
  });
  it('fails closed on empty/missing input', () => {
    const result = evaluatePreDialGate({});
    expect(result.allowed).toBe(false);
    expect(result.checks.length).toBe(7);
  });
  it('blocks a suppressed (DNCR/opt-out) destination regardless of format', () => {
    const input = validInput();
    input.suppressionNumbers = ['0501234567']; // same number, trunk format
    expect(evaluatePreDialGate(input).allowed).toBe(false);
  });
  it('blocks an unregistered CLI', () => {
    const input = validInput();
    input.cliNumber = '+971 50 555 0101';
    expect(evaluatePreDialGate(input).allowed).toBe(false);
  });
  it('blocks outside calling hours', () => {
    const input = validInput();
    input.scheduledAt = '2026-11-19T15:00:00Z'; // 19:00 Dubai
    expect(evaluatePreDialGate(input).allowed).toBe(false);
  });
  it('blocks after refusal or global opt-out', () => {
    expect(evaluatePreDialGate({ ...validInput(), consumerRefused: true }).allowed).toBe(false);
    expect(evaluatePreDialGate({ ...validInput(), globalOptOut: true }).allowed).toBe(false);
  });
  it('enforces retry ceilings (1/day, 2/week)', () => {
    expect(
      evaluatePreDialGate({
        ...validInput(),
        attempts: { callbacksToday: 1, callbacksThisWeek: 1 },
      }).allowed,
    ).toBe(false);
    expect(
      evaluatePreDialGate({
        ...validInput(),
        attempts: { callbacksToday: 0, callbacksThisWeek: 2 },
      }).allowed,
    ).toBe(false);
  });
  it('requires opener disclosure, and AI disclosure for automated calls', () => {
    const noNotice = validInput();
    noNotice.opener = { ...noNotice.opener, recordingNotice: '' };
    expect(evaluatePreDialGate(noNotice).allowed).toBe(false);
    const noAi = validInput();
    noAi.opener = { ...noAi.opener, aiDisclosure: false };
    expect(evaluatePreDialGate(noAi).allowed).toBe(false);
    const humanCall = validInput();
    humanCall.opener = { ...humanCall.opener, automated: false, aiDisclosure: false };
    expect(evaluatePreDialGate(humanCall).allowed).toBe(true);
  });
  it('requires a consent ledger reference', () => {
    expect(evaluatePreDialGate({ ...validInput(), consentRef: null }).allowed).toBe(false);
  });
});

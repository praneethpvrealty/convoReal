import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_WINDOW_EXPIRED_MESSAGE,
  CUSTOMER_WINDOW_MS,
  isReengagementError,
  isWithinCustomerWindow,
} from './customer-window';

const NOW = Date.parse('2026-07-27T12:00:00.000Z');

describe('isWithinCustomerWindow', () => {
  it('allows a message sent moments ago', () => {
    expect(isWithinCustomerWindow(new Date(NOW - 60_000).toISOString(), NOW)).toBe(true);
  });

  it('allows the last millisecond inside the window', () => {
    const at = new Date(NOW - CUSTOMER_WINDOW_MS + 1).toISOString();
    expect(isWithinCustomerWindow(at, NOW)).toBe(true);
  });

  it('closes exactly at 24 hours', () => {
    const at = new Date(NOW - CUSTOMER_WINDOW_MS).toISOString();
    expect(isWithinCustomerWindow(at, NOW)).toBe(false);
  });

  it('rejects a contact who has never messaged in', () => {
    expect(isWithinCustomerWindow(null, NOW)).toBe(false);
    expect(isWithinCustomerWindow(undefined, NOW)).toBe(false);
  });

  it('rejects an unparseable timestamp rather than treating it as now', () => {
    expect(isWithinCustomerWindow('not a date', NOW)).toBe(false);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(isWithinCustomerWindow(new Date(NOW - 1000), NOW)).toBe(true);
  });
});

describe('isReengagementError', () => {
  it("recognises Meta's numeric code", () => {
    expect(isReengagementError(new Error('Meta API error 131047: blocked'))).toBe(true);
  });

  it('recognises the human-readable variants regardless of case', () => {
    expect(isReengagementError(new Error('Re-Engagement message required'))).toBe(true);
    expect(isReengagementError(new Error('outside the 24 HOURS window'))).toBe(true);
  });

  it('recognises our own pre-flight throw', () => {
    expect(isReengagementError(new Error(CUSTOMER_WINDOW_EXPIRED_MESSAGE))).toBe(true);
  });

  it('accepts a bare string', () => {
    expect(isReengagementError('131047')).toBe(true);
  });

  it('leaves unrelated failures alone', () => {
    expect(isReengagementError(new Error('Contact phone number not found'))).toBe(false);
    expect(isReengagementError(null)).toBe(false);
    expect(isReengagementError({ code: 131047 })).toBe(false);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { signOAuthState, verifyOAuthState, generateNonce } from '@/lib/meta-ads/oauth-state';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('signOAuthState / verifyOAuthState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a valid state', () => {
    const payload = { accountId: 'acc-1', nonce: 'n-1', ts: Date.now() };
    const state = signOAuthState(payload, SECRET);
    const result = verifyOAuthState(state, SECRET, 'n-1');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload).toEqual(payload);
    }
  });

  it('rejects a state signed with a different secret', () => {
    const state = signOAuthState({ accountId: 'acc-1', nonce: 'n-1', ts: Date.now() }, 'other-secret');
    const result = verifyOAuthState(state, SECRET, 'n-1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const state = signOAuthState({ accountId: 'acc-1', nonce: 'n-1', ts: Date.now() }, SECRET);
    const [encoded] = state.split('.');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const tamperedEncoded = Buffer.from(
      JSON.stringify({ ...decoded, accountId: 'attacker-account' }),
      'utf8',
    ).toString('base64url');
    const tamperedState = `${tamperedEncoded}.${state.split('.')[1]}`;
    const result = verifyOAuthState(tamperedState, SECRET, 'n-1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a mismatched nonce (cookie/state pairing)', () => {
    const state = signOAuthState({ accountId: 'acc-1', nonce: 'n-1', ts: Date.now() }, SECRET);
    const result = verifyOAuthState(state, SECRET, 'different-nonce');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('accepts when no expected nonce is passed (nonce check skipped)', () => {
    const state = signOAuthState({ accountId: 'acc-1', nonce: 'n-1', ts: Date.now() }, SECRET);
    const result = verifyOAuthState(state, SECRET);
    expect(result.valid).toBe(true);
  });

  it('rejects an expired state (older than 10 minutes)', () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const state = signOAuthState({ accountId: 'acc-1', nonce: 'n-1', ts: elevenMinutesAgo }, SECRET);
    const result = verifyOAuthState(state, SECRET, 'n-1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('expired');
  });

  it('accepts a state right at the boundary (just under 10 minutes)', () => {
    const nineMinutesAgo = Date.now() - 9 * 60 * 1000;
    const state = signOAuthState({ accountId: 'acc-1', nonce: 'n-1', ts: nineMinutesAgo }, SECRET);
    const result = verifyOAuthState(state, SECRET, 'n-1');
    expect(result.valid).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(verifyOAuthState(null, SECRET).valid).toBe(false);
    expect(verifyOAuthState('', SECRET).valid).toBe(false);
    expect(verifyOAuthState('not-a-valid-state', SECRET).valid).toBe(false);
    expect(verifyOAuthState('.', SECRET).valid).toBe(false);
  });

  it('rejects a base64url-valid but non-JSON encoded segment', () => {
    const bogus = Buffer.from('not json', 'utf8').toString('base64url');
    const state = `${bogus}.deadbeef`;
    const result = verifyOAuthState(state, SECRET, 'n-1');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });
});

describe('generateNonce', () => {
  it('produces distinct, non-empty values', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

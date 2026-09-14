import { describe, expect, it } from 'vitest';
import {
  isOpaqueSignupError,
  signupRefusalMessage,
  SIGNUP_REFUSAL_REASONS,
} from './signup-eligibility';

describe('isOpaqueSignupError', () => {
  it('recognises what GoTrue returns for a trigger exception', () => {
    expect(isOpaqueSignupError('Database error creating new user')).toBe(true);
    expect(isOpaqueSignupError('database error saving new user')).toBe(true);
    expect(isOpaqueSignupError('  Database error creating new user  ')).toBe(
      true
    );
  });

  it('leaves messages that already say something useful', () => {
    expect(isOpaqueSignupError('User already registered')).toBe(false);
    expect(
      isOpaqueSignupError('Password should be at least 6 characters')
    ).toBe(false);
  });
});

describe('signupRefusalMessage', () => {
  it('speaks the trigger message for each refusal', () => {
    expect(signupRefusalMessage('expired')).toMatch(/expired/i);
    expect(signupRefusalMessage('claimed')).toMatch(/already been claimed/i);
    expect(signupRefusalMessage('revoked')).toMatch(/withdrawn/i);
    expect(signupRefusalMessage('seats_full')).toMatch(/seats have been/i);
    expect(signupRefusalMessage('no_invite')).toMatch(/invite-only/i);
  });

  it('blames nothing it cannot prove when the gate allowed the signup', () => {
    expect(signupRefusalMessage('eligible')).not.toMatch(/invit/i);
    expect(signupRefusalMessage('unknown')).not.toMatch(/invit/i);
  });

  it('has a message for every reason', () => {
    for (const reason of SIGNUP_REFUSAL_REASONS)
      expect(signupRefusalMessage(reason).length).toBeGreaterThan(10);
  });
});

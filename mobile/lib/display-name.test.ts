import { describe, expect, it } from 'vitest';
import { resolveDisplayName, resolveGreetingName } from './display-name';

describe('resolveGreetingName', () => {
  it('uses the profile name over the email, which is the reported bug', () => {
    // Profile said "Praneeth"; the inbox greeted "Praneethpvrealty"
    // because it only ever read the email.
    expect(resolveGreetingName('Praneeth', 'praneethpvrealty@gmail.com')).toBe('Praneeth');
  });

  it('greets with the first name only', () => {
    expect(resolveGreetingName('Praneeth Kumar Sajepa', 'x@y.com')).toBe('Praneeth');
  });

  it('falls back to the email local part when no profile name is set', () => {
    expect(resolveGreetingName(null, 'praneethpvrealty@gmail.com')).toBe('Praneethpvrealty');
    expect(resolveGreetingName('   ', 'ravi@example.com')).toBe('Ravi');
  });

  it('splits a separated email local part into a first name', () => {
    expect(resolveGreetingName(null, 'praneeth.kumar@gmail.com')).toBe('Praneeth');
    expect(resolveGreetingName(null, 'praneeth_kumar@gmail.com')).toBe('Praneeth');
    expect(resolveGreetingName(null, 'praneeth-kumar@gmail.com')).toBe('Praneeth');
  });

  it('falls back to "there" with nothing to go on', () => {
    expect(resolveGreetingName(null, null)).toBe('there');
    expect(resolveGreetingName(undefined, undefined)).toBe('there');
    expect(resolveGreetingName('', '')).toBe('there');
  });

  it('leaves an already-capitalised name alone', () => {
    expect(resolveGreetingName('RAVI', null)).toBe('RAVI');
  });
});

describe('resolveDisplayName', () => {
  it('keeps the whole name for a profile card', () => {
    expect(resolveDisplayName('Praneeth Kumar Sajepa', 'x@y.com')).toBe('Praneeth Kumar Sajepa');
  });

  it('falls back to the email local part, capitalised', () => {
    expect(resolveDisplayName(null, 'praneethpvrealty@gmail.com')).toBe('Praneethpvrealty');
  });

  it('falls back to Account with nothing to go on', () => {
    expect(resolveDisplayName(null, null)).toBe('Account');
    expect(resolveDisplayName('  ', '')).toBe('Account');
  });
});

import { describe, expect, it } from 'vitest';

import {
  greetingName,
  isPlaceholderLeadName,
  placeholderLeadName,
} from './lead-placeholder';

describe('placeholderLeadName', () => {
  it('names the placeholder after the portal', () => {
    expect(placeholderLeadName('Housing')).toBe('Housing Lead');
    expect(placeholderLeadName('99acres')).toBe('99acres Lead');
  });

  it('falls back when the portal is unknown', () => {
    expect(placeholderLeadName('Others')).toBe('Portal Lead');
    expect(placeholderLeadName(null)).toBe('Portal Lead');
  });
});

describe('isPlaceholderLeadName', () => {
  it('recognises every placeholder it mints', () => {
    for (const source of ['Housing', '99acres', 'Magic Bricks', 'Others', null]) {
      expect(isPlaceholderLeadName(placeholderLeadName(source))).toBe(true);
    }
  });

  it('treats a blank name as a placeholder — "Hi ," is no better', () => {
    expect(isPlaceholderLeadName('')).toBe(true);
    expect(isPlaceholderLeadName(undefined)).toBe(true);
  });

  it('leaves real people alone, including one surnamed Lead', () => {
    expect(isPlaceholderLeadName('Sheetal Sawarthia')).toBe(false);
    expect(isPlaceholderLeadName('Priya Lead Sharma')).toBe(false);
  });

  // The parser rejects these on the way in now, but rows saved before it
  // did are still in the book — one "Housing User" is live today.
  it('recognises the mask the portal sent, not just the one we mint', () => {
    expect(isPlaceholderLeadName('Housing User')).toBe(true);
    expect(isPlaceholderLeadName('99acres User')).toBe(true);
    expect(isPlaceholderLeadName('User')).toBe(true);
    expect(isPlaceholderLeadName('Unknown')).toBe(true);
  });

  it('does not mistake a real name that merely contains one', () => {
    expect(isPlaceholderLeadName('Guest Rao')).toBe(false);
    expect(isPlaceholderLeadName('Omi NA')).toBe(false);
    expect(isPlaceholderLeadName('Housing Kumar')).toBe(false);
  });
});

describe('greetingName', () => {
  // "Hi Portal Lead, thanks for your interest" reached a real buyer.
  it('never greets a lead by its placeholder', () => {
    expect(greetingName('Portal Lead')).toBe('there');
    expect(greetingName('Housing Lead')).toBe('there');
    expect(greetingName(null)).toBe('there');
  });

  // Left as-is this greets a real buyer "Hi Housing," — the alert
  // template takes the first word.
  it('never greets a lead by the portal that masked it', () => {
    expect(greetingName('Housing User')).toBe('there');
    expect(greetingName('User')).toBe('there');
  });

  it('uses a real name as given', () => {
    expect(greetingName('Sheetal Sawarthia')).toBe('Sheetal Sawarthia');
  });
});

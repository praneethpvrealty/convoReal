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
});

describe('greetingName', () => {
  // "Hi Portal Lead, thanks for your interest" reached a real buyer.
  it('never greets a lead by its placeholder', () => {
    expect(greetingName('Portal Lead')).toBe('there');
    expect(greetingName('Housing Lead')).toBe('there');
    expect(greetingName(null)).toBe('there');
  });

  it('uses a real name as given', () => {
    expect(greetingName('Sheetal Sawarthia')).toBe('Sheetal Sawarthia');
  });
});

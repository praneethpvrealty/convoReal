import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDeliberateSignOut,
  isDeliberateSignOut,
  markDeliberateSignOut,
} from './deliberate-sign-out';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

afterEach(() => store.clear());

describe('[ACC-010] a deliberate sign-out is never shown as expired', () => {
  it('is seen by every tab for a minute after the user signs out', () => {
    markDeliberateSignOut(1_000);
    expect(isDeliberateSignOut(1_000 + 59_000)).toBe(true);
    expect(isDeliberateSignOut(1_000 + 61_000)).toBe(false);
  });

  it('is cleared by the next sign-in', () => {
    markDeliberateSignOut(1_000);
    clearDeliberateSignOut();
    expect(isDeliberateSignOut(2_000)).toBe(false);
  });

  it('is false when nothing was marked', () => {
    expect(isDeliberateSignOut()).toBe(false);
  });
});

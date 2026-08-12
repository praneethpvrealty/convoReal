// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  readStored,
  readStoredJson,
  removeStored,
  storageAvailable,
  writeStored,
} from '@/lib/safe-storage';

/** Chrome with site data blocked: touching the property throws, rather
 *  than the store returning null or the methods failing. */
function blockStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException(
        "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
        'SecurityError'
      );
    },
  });
}

const realLocalStorage = Object.getOwnPropertyDescriptor(
  window,
  'localStorage'
);

afterEach(() => {
  if (realLocalStorage) {
    Object.defineProperty(window, 'localStorage', realLocalStorage);
  }
  vi.restoreAllMocks();
});

describe('safe-storage with storage blocked', () => {
  // The reported crash: one unguarded read during mount took the whole
  // showcase to the error boundary for a visitor who had blocked site
  // data. None of these may throw.
  it('never throws', () => {
    blockStorage();
    expect(() => readStored('k')).not.toThrow();
    expect(() => writeStored('k', 'v')).not.toThrow();
    expect(() => removeStored('k')).not.toThrow();
    expect(() => readStoredJson('k', { a: 1 })).not.toThrow();
    expect(() => storageAvailable()).not.toThrow();
  });

  it('degrades to absent rather than to an exception', () => {
    blockStorage();
    expect(readStored('k')).toBeNull();
    expect(writeStored('k', 'v')).toBe(false);
    expect(readStoredJson('k', { a: 1 })).toEqual({ a: 1 });
    expect(storageAvailable()).toBe(false);
  });
});

describe('safe-storage with storage working', () => {
  it('round-trips a value', () => {
    expect(writeStored('sst-k', 'v')).toBe(true);
    expect(readStored('sst-k')).toBe('v');
    removeStored('sst-k');
    expect(readStored('sst-k')).toBeNull();
    expect(storageAvailable()).toBe(true);
  });

  it('round-trips JSON', () => {
    writeStored('sst-j', JSON.stringify({ a: 1 }));
    expect(readStoredJson('sst-j', null)).toEqual({ a: 1 });
    removeStored('sst-j');
  });

  // A half-written entry is as fatal as a blocked store if the parse is
  // not caught — the showcase already learned this once.
  it('falls back when the stored value is not valid JSON', () => {
    writeStored('sst-bad', '{oops');
    expect(readStoredJson('sst-bad', { safe: true })).toEqual({ safe: true });
    removeStored('sst-bad');
  });

  it('setItem throwing on a full quota reports false, not a crash', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    expect(writeStored('sst-q', 'v')).toBe(false);
  });
});

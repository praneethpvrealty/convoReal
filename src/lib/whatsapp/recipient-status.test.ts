import { describe, expect, it } from 'vitest';

import { isValidStatusTransition, ladderLevel } from './recipient-status';

describe('ladderLevel', () => {
  it('orders the ladder pending < sent < delivered < read < replied', () => {
    expect(ladderLevel('pending')).toBeLessThan(ladderLevel('sent'));
    expect(ladderLevel('sent')).toBeLessThan(ladderLevel('delivered'));
    expect(ladderLevel('delivered')).toBeLessThan(ladderLevel('read'));
    expect(ladderLevel('read')).toBeLessThan(ladderLevel('replied'));
  });

  it('returns -1 for anything off the ladder', () => {
    expect(ladderLevel('failed')).toBe(-1);
    expect(ladderLevel('bogus')).toBe(-1);
  });
});

describe('isValidStatusTransition — forward only', () => {
  it('accepts strict forward moves', () => {
    expect(isValidStatusTransition('pending', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'delivered')).toBe(true);
    expect(isValidStatusTransition('delivered', 'read')).toBe(true);
    expect(isValidStatusTransition('read', 'replied')).toBe(true);
    expect(isValidStatusTransition('sent', 'read')).toBe(true); // may skip rungs
  });

  it('rejects out-of-order webhooks that would regress status', () => {
    // Meta delivers status callbacks unordered — a late "delivered"
    // must not overwrite a "read" already recorded.
    expect(isValidStatusTransition('read', 'delivered')).toBe(false);
    expect(isValidStatusTransition('delivered', 'sent')).toBe(false);
    expect(isValidStatusTransition('replied', 'read')).toBe(false);
  });

  it('rejects a no-op transition to the same status', () => {
    expect(isValidStatusTransition('read', 'read')).toBe(false);
  });
});

describe('isValidStatusTransition — failed is a terminal side rung', () => {
  it('accepts failed only from an unconfirmed state', () => {
    expect(isValidStatusTransition('pending', 'failed')).toBe(true);
    expect(isValidStatusTransition('sent', 'failed')).toBe(true);
  });

  it('rejects failed once the message is known delivered/read/replied', () => {
    expect(isValidStatusTransition('delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition('read', 'failed')).toBe(false);
    expect(isValidStatusTransition('replied', 'failed')).toBe(false);
  });

  it('never transitions out of failed', () => {
    for (const next of ['pending', 'sent', 'delivered', 'read', 'replied', 'failed']) {
      expect(isValidStatusTransition('failed', next)).toBe(false);
    }
  });
});

describe('isValidStatusTransition — unknown current status', () => {
  it('accepts a known incoming status from an unknown current one', () => {
    expect(isValidStatusTransition('bogus', 'delivered')).toBe(true);
  });

  it('rejects an unknown incoming status', () => {
    expect(isValidStatusTransition('sent', 'bogus')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { isValidStatusTransition } from './status-updates';

describe('isValidStatusTransition', () => {
  it('only moves a recipient up the ladder', () => {
    expect(isValidStatusTransition('pending', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'read')).toBe(true);
    expect(isValidStatusTransition('read', 'delivered')).toBe(false);
    expect(isValidStatusTransition('replied', 'read')).toBe(false);
    expect(isValidStatusTransition('sent', 'sent')).toBe(false);
  });

  it('fails only from pending or sent, and never recovers from failed', () => {
    expect(isValidStatusTransition('pending', 'failed')).toBe(true);
    expect(isValidStatusTransition('sent', 'failed')).toBe(true);
    expect(isValidStatusTransition('delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition('failed', 'delivered')).toBe(false);
  });

  it('accepts any ladder status over an unknown one and rejects unknown targets', () => {
    expect(isValidStatusTransition('mystery', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'mystery')).toBe(false);
  });
});

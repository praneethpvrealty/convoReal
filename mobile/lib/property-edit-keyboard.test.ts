import { describe, expect, it } from 'vitest';

import { propertyEditKeyboardBehavior } from './property-edit-keyboard';

describe('propertyEditKeyboardBehavior', () => {
  it('moves the Property Edit form above the Android keyboard', () => {
    expect(propertyEditKeyboardBehavior('android')).toBe('position');
  });

  it('keeps the native padding behavior on iOS', () => {
    expect(propertyEditKeyboardBehavior('ios')).toBe('padding');
  });
});

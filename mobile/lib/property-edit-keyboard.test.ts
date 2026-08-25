import { describe, expect, it } from 'vitest';

import { propertyEditKeyboardBehavior } from './property-edit-keyboard';

describe('propertyEditKeyboardBehavior', () => {
  it('shrinks the Android editor so its scroll view keeps the focused field visible', () => {
    expect(propertyEditKeyboardBehavior('android')).toBe('height');
  });

  it('keeps the native padding behavior on iOS', () => {
    expect(propertyEditKeyboardBehavior('ios')).toBe('padding');
  });
});

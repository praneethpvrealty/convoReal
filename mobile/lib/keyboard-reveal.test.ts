import { describe, expect, it } from 'vitest';

import { KEYBOARD_REVEAL_MARGIN, keyboardRevealDelta } from './keyboard-reveal';

describe('keyboardRevealDelta', () => {
  it('[PRP-057] scrolls a field hidden under the keyboard up to a margin above it', () => {
    expect(
      keyboardRevealDelta({
        fieldTop: 700,
        fieldBottom: 790,
        viewportTop: 100,
        keyboardTop: 600,
        margin: 24,
      })
    ).toBe(214);
  });

  it('[PRP-057] leaves a field that already shows above the keyboard alone', () => {
    expect(
      keyboardRevealDelta({
        fieldTop: 300,
        fieldBottom: 390,
        viewportTop: 100,
        keyboardTop: 600,
        margin: 24,
      })
    ).toBe(0);
    expect(
      keyboardRevealDelta({
        fieldTop: 486,
        fieldBottom: 576,
        viewportTop: 100,
        keyboardTop: 600,
        margin: 24,
      })
    ).toBe(0);
  });

  it('[PRP-057] keeps the top of a tall field in view rather than scrolling it out', () => {
    expect(
      keyboardRevealDelta({
        fieldTop: 200,
        fieldBottom: 900,
        viewportTop: 100,
        keyboardTop: 600,
        margin: 24,
      })
    ).toBe(76);
    expect(
      keyboardRevealDelta({
        fieldTop: 110,
        fieldBottom: 900,
        viewportTop: 100,
        keyboardTop: 600,
        margin: 24,
      })
    ).toBe(0);
  });

  it('[PRP-057] uses the shared margin by default', () => {
    expect(
      keyboardRevealDelta({
        fieldTop: 700,
        fieldBottom: 790,
        viewportTop: 100,
        keyboardTop: 600,
      })
    ).toBe(190 + KEYBOARD_REVEAL_MARGIN);
  });
});

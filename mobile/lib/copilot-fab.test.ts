import { describe, expect, it } from 'vitest';

import {
  COPILOT_FAB_EDGE,
  COPILOT_FAB_SIZE,
  clampCopilotFabBottom,
  copilotFabBottom,
  copilotFabClearance,
  copilotFabLeft,
  defaultCopilotFabPlacement,
  isCopilotFabDrag,
  parseCopilotFabPlacement,
  snapCopilotFab,
} from './copilot-fab';

describe('copilot FAB geometry', () => {
  it('floats above the tab bar with a 12pt floor when there is no home indicator', () => {
    expect(copilotFabBottom(0)).toBe(102);
    expect(copilotFabBottom(34)).toBe(124);
  });

  it('gives a full-height list enough padding to scroll its last row clear of the button', () => {
    expect(copilotFabClearance(0)).toBe(
      copilotFabBottom(0) + COPILOT_FAB_SIZE + 16
    );
    expect(copilotFabClearance(34)).toBe(192);
  });
});

describe('[CPL-001] draggable copilot FAB', () => {
  const frame = {
    screenWidth: 400,
    screenHeight: 800,
    insetTop: 24,
    insetBottom: 0,
  };

  it('starts in the bottom-right corner above the tab bar', () => {
    expect(defaultCopilotFabPlacement(0)).toEqual({
      side: 'right',
      bottom: copilotFabBottom(0),
    });
    expect(copilotFabLeft('right', 400)).toBe(
      400 - COPILOT_FAB_EDGE - COPILOT_FAB_SIZE
    );
    expect(copilotFabLeft('left', 400)).toBe(COPILOT_FAB_EDGE);
  });

  it('snaps to whichever edge the button is dropped nearer', () => {
    const start = defaultCopilotFabPlacement(0);
    expect(snapCopilotFab(start, -150, 0, frame).side).toBe('right');
    expect(snapCopilotFab(start, -250, 0, frame).side).toBe('left');
  });

  it('moves up with the finger but never above the header or below the tab bar', () => {
    const start = defaultCopilotFabPlacement(0);
    expect(snapCopilotFab(start, 0, -200, frame).bottom).toBe(
      start.bottom + 200
    );
    expect(snapCopilotFab(start, 0, -5000, frame).bottom).toBe(
      800 - 24 - 56 - COPILOT_FAB_SIZE - 16
    );
    expect(snapCopilotFab(start, 0, 5000, frame).bottom).toBe(
      copilotFabBottom(0)
    );
    expect(clampCopilotFabBottom(-10, frame)).toBe(copilotFabBottom(0));
  });

  it('treats a small wobble as a tap, not a drag', () => {
    expect(isCopilotFabDrag(3, 4)).toBe(false);
    expect(isCopilotFabDrag(0, 12)).toBe(true);
  });

  it('restores only a well-formed saved placement', () => {
    expect(parseCopilotFabPlacement('{"side":"left","bottom":300}')).toEqual({
      side: 'left',
      bottom: 300,
    });
    expect(parseCopilotFabPlacement('{"side":"top","bottom":300}')).toBeNull();
    expect(parseCopilotFabPlacement('not json')).toBeNull();
    expect(parseCopilotFabPlacement(null)).toBeNull();
  });
});

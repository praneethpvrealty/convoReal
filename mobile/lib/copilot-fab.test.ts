import { describe, expect, it } from 'vitest';

import {
  COPILOT_FAB_SIZE,
  copilotFabBottom,
  copilotFabClearance,
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

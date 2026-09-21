import { describe, expect, it } from 'vitest';
import { importCountLabel } from './import-counts';

describe('import count label', () => {
  it('reads the same as the web chip', () => {
    expect(importCountLabel(1)).toBe('Shared by 1 agent');
    expect(importCountLabel(3)).toBe('Shared by 3 agents');
  });
});

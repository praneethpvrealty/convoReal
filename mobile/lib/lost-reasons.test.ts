import { describe, expect, it } from 'vitest';

import { LOST_REASONS, parseLostReason } from '@/lib/lost-reasons';

describe('lost reasons', () => {
  it('matches the web list and asks for a note on Other', () => {
    expect(LOST_REASONS).toContain('Price disagreement');
    expect(LOST_REASONS[LOST_REASONS.length - 1]).toBe('Other');
    expect(parseLostReason({ lost_reason: 'Other' }).ok).toBe(false);
    expect(
      parseLostReason({ lost_reason: 'Owner backed out', lost_note: ' x ' })
    ).toEqual({
      ok: true,
      value: { lost_reason: 'Owner backed out', lost_note: 'x' },
    });
  });
});

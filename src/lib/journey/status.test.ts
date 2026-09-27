import { describe, expect, it } from 'vitest';

import { parseJourneyStatusInput } from './status';

describe('parseJourneyStatusInput', () => {
  it('accepts a drop with its reason and a reactivation', () => {
    expect(
      parseJourneyStatusInput({
        item_id: ' item-1 ',
        action: 'drop',
        reason: ' Budget ',
      })
    ).toEqual({
      ok: true,
      value: { itemId: 'item-1', action: 'drop', reason: 'Budget' },
    });
    expect(
      parseJourneyStatusInput({ item_id: 'item-1', action: 'reactivate' })
    ).toEqual({
      ok: true,
      value: { itemId: 'item-1', action: 'reactivate', reason: null },
    });
  });

  it('rejects a missing item or an unknown action', () => {
    expect(parseJourneyStatusInput({ action: 'drop' }).ok).toBe(false);
    expect(
      parseJourneyStatusInput({ item_id: 'item-1', action: 'delete' }).ok
    ).toBe(false);
    expect(parseJourneyStatusInput(null).ok).toBe(false);
  });
});

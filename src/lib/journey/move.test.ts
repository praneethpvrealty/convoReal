import { describe, expect, it } from 'vitest';

import { parseJourneyMoveInput } from './move';

describe('[TXW-018] journey move input', () => {
  it('requires an item and a stage and defaults the event to moved', () => {
    expect(
      parseJourneyMoveInput({ item_id: ' i-1 ', stage_id: 's-1 ' })
    ).toEqual({
      ok: true,
      value: { itemId: 'i-1', stageId: 's-1', eventType: 'moved' },
    });
    expect(
      parseJourneyMoveInput({
        item_id: 'i-1',
        stage_id: 's-1',
        event_type: 'advanced',
      })
    ).toEqual({
      ok: true,
      value: { itemId: 'i-1', stageId: 's-1', eventType: 'advanced' },
    });
    expect(
      parseJourneyMoveInput({
        item_id: 'i-1',
        stage_id: 's-1',
        event_type: 'x',
      })
    ).toEqual({
      ok: true,
      value: { itemId: 'i-1', stageId: 's-1', eventType: 'moved' },
    });
  });

  it('rejects a missing item or stage', () => {
    for (const raw of [null, {}, { item_id: 'i-1' }, { stage_id: 's-1' }]) {
      expect(parseJourneyMoveInput(raw)).toEqual({
        ok: false,
        error: 'item_id and stage_id are required',
      });
    }
  });
});

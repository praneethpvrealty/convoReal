import { describe, expect, it } from 'vitest';

import { parseStageNoteInput } from './stage-notes';

describe('parseStageNoteInput', () => {
  it('[JRN-004] preserves a trimmed note for one journey item and stage', () => {
    expect(
      parseStageNoteInput({
        item_id: 'item-1',
        stage_id: 'token-paid',
        note: '  Paid ₹1 lakh token  ',
      })
    ).toEqual({
      ok: true,
      value: {
        itemId: 'item-1',
        stageId: 'token-paid',
        note: 'Paid ₹1 lakh token',
      },
    });
  });

  it('[JRN-004] rejects blank and oversized stage notes', () => {
    expect(
      parseStageNoteInput({ item_id: 'i', stage_id: 's', note: '   ' })
    ).toEqual({
      ok: false,
      error: 'item_id, stage_id and note are required',
    });
    expect(
      parseStageNoteInput({
        item_id: 'i',
        stage_id: 's',
        note: 'x'.repeat(1001),
      })
    ).toEqual({
      ok: false,
      error: 'Stage note must be 1,000 characters or less',
    });
  });
});

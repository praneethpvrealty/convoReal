export interface StageNoteInput {
  itemId: string;
  stageId: string;
  note: string;
}

type ParseStageNoteResult =
  { ok: true; value: StageNoteInput } | { ok: false; error: string };

export function parseStageNoteInput(raw: unknown): ParseStageNoteResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'item_id, stage_id and note are required' };
  }
  const input = raw as Record<string, unknown>;
  const itemId = typeof input.item_id === 'string' ? input.item_id.trim() : '';
  const stageId =
    typeof input.stage_id === 'string' ? input.stage_id.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!itemId || !stageId || !note) {
    return { ok: false, error: 'item_id, stage_id and note are required' };
  }
  if (note.length > 1000) {
    return {
      ok: false,
      error: 'Stage note must be 1,000 characters or less',
    };
  }
  return { ok: true, value: { itemId, stageId, note } };
}

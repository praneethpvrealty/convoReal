import type { JourneyEventType } from '@/types';

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type JourneyMoveEventType = Extract<
  JourneyEventType,
  'advanced' | 'moved'
>;

export function parseJourneyMoveInput(raw: unknown): ParseResult<{
  itemId: string;
  stageId: string;
  eventType: JourneyMoveEventType;
}> {
  if (!raw || typeof raw !== 'object')
    return { ok: false, error: 'item_id and stage_id are required' };
  const input = raw as Record<string, unknown>;
  const itemId = typeof input.item_id === 'string' ? input.item_id.trim() : '';
  const stageId =
    typeof input.stage_id === 'string' ? input.stage_id.trim() : '';
  if (!itemId || !stageId)
    return { ok: false, error: 'item_id and stage_id are required' };
  const eventType: JourneyMoveEventType =
    input.event_type === 'advanced' ? 'advanced' : 'moved';
  return { ok: true, value: { itemId, stageId, eventType } };
}

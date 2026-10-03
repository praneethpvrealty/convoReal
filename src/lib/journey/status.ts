type StatusAction = 'drop' | 'reactivate';

export function parseJourneyStatusInput(raw: unknown):
  | {
      ok: true;
      value: { itemId: string; action: StatusAction; reason: string | null };
    }
  | { ok: false; error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const itemId = typeof body.item_id === 'string' ? body.item_id.trim() : '';
  if (!itemId) return { ok: false, error: 'item_id is required' };
  if (body.action !== 'drop' && body.action !== 'reactivate') {
    return { ok: false, error: 'action must be drop or reactivate' };
  }
  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;
  return { ok: true, value: { itemId, action: body.action, reason } };
}

export type QuickCallOutcome = 'connected' | 'no_answer' | 'busy';

export interface CallLogPayload {
  direction: 'outbound';
  outcome: QuickCallOutcome;
  called_at: string;
  duration_seconds: number | null;
  notes: string | null;
}

export function callLogPayload(input: {
  outcome: QuickCallOutcome;
  calledAt: string;
  notes?: string | null;
  durationMins?: string | number | null;
}): CallLogPayload {
  const connected = input.outcome === 'connected';
  const mins =
    typeof input.durationMins === 'number'
      ? input.durationMins
      : parseFloat(input.durationMins ?? '');
  const notes = connected ? (input.notes ?? '').trim() : '';
  return {
    direction: 'outbound',
    outcome: input.outcome,
    called_at: input.calledAt,
    duration_seconds:
      connected && Number.isFinite(mins) && mins > 0
        ? Math.round(mins * 60)
        : null,
    notes: notes || null,
  };
}

export function callFollowUpTitle(contact: {
  name?: string | null;
  phone: string;
}): string {
  return `Follow-up with ${contact.name?.trim() || contact.phone}`;
}

export const CALL_FOLLOW_UP_EVENT_TYPE = 'follow_up';

export function scheduledCallTitle(contact: {
  name?: string | null;
  phone: string;
}): string {
  return `Call ${contact.name?.trim() || contact.phone}`;
}

export const SCHEDULED_CALL_EVENT_TYPE = 'call';

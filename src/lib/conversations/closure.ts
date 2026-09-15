import type { ConversationStatus } from '@/types';

export const CONVERSATION_CLOSE_REASONS = [
  { value: 'requirement_unmatched', label: 'Requirement not matched' },
  { value: 'not_responding', label: 'Not responding' },
  { value: 'requirement_on_hold', label: 'Requirement on hold' },
  {
    value: 'budget_or_location_changed',
    label: 'Budget or location changed',
  },
  { value: 'completed_elsewhere', label: 'Bought or rented elsewhere' },
  { value: 'enquiry_resolved', label: 'Enquiry resolved' },
  { value: 'duplicate_or_invalid', label: 'Duplicate or invalid lead' },
  { value: 'other', label: 'Other' },
] as const;

export type ConversationCloseReason =
  (typeof CONVERSATION_CLOSE_REASONS)[number]['value'];

export const CONVERSATION_CLOSE_NOTE_MAX_LENGTH = 500;

export function conversationCloseReasonLabel(
  reason: ConversationCloseReason | null | undefined
): string | null {
  return (
    CONVERSATION_CLOSE_REASONS.find((option) => option.value === reason)
      ?.label ?? null
  );
}

export function conversationStatusUpdate(
  status: Exclude<ConversationStatus, 'closed'>
): {
  status: Exclude<ConversationStatus, 'closed'>;
  close_reason: null;
  close_note: null;
  closed_at: null;
};
export function conversationStatusUpdate(
  status: 'closed',
  reason: ConversationCloseReason,
  note?: string,
  closedAt?: string
): {
  status: 'closed';
  close_reason: ConversationCloseReason;
  close_note: string | null;
  closed_at: string;
};
export function conversationStatusUpdate(
  status: ConversationStatus,
  reason?: ConversationCloseReason,
  note = '',
  closedAt = new Date().toISOString()
) {
  if (status !== 'closed') {
    return {
      status,
      close_reason: null,
      close_note: null,
      closed_at: null,
    };
  }

  if (!reason) throw new Error('Choose a reason for closing this lead.');
  const cleanNote = note.trim();
  if (cleanNote.length > CONVERSATION_CLOSE_NOTE_MAX_LENGTH) {
    throw new Error(
      `Keep the closing note under ${CONVERSATION_CLOSE_NOTE_MAX_LENGTH} characters.`
    );
  }
  if (reason === 'other' && !cleanNote) {
    throw new Error('Add a note explaining the closing reason.');
  }

  return {
    status,
    close_reason: reason,
    close_note: cleanNote || null,
    closed_at: closedAt,
  };
}

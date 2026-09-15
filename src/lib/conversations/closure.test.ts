import { describe, expect, it } from 'vitest';

import {
  conversationCloseReasonLabel,
  conversationStatusUpdate,
} from '@/lib/conversations/closure';

describe('conversation closure', () => {
  it('[INB-001] records a structured reason, optional note and timestamp', () => {
    expect(
      conversationStatusUpdate(
        'closed',
        'requirement_unmatched',
        ' Needs a larger plot. ',
        '2026-09-15T02:00:00.000Z'
      )
    ).toEqual({
      status: 'closed',
      close_reason: 'requirement_unmatched',
      close_note: 'Needs a larger plot.',
      closed_at: '2026-09-15T02:00:00.000Z',
    });
    expect(conversationCloseReasonLabel('not_responding')).toBe(
      'Not responding'
    );
  });

  it('[INB-001] requires an explanation for Other', () => {
    expect(() => conversationStatusUpdate('closed', 'other')).toThrow(
      'Add a note'
    );
  });

  it('[INB-001] clears closure details when a lead is reopened', () => {
    expect(conversationStatusUpdate('open')).toEqual({
      status: 'open',
      close_reason: null,
      close_note: null,
      closed_at: null,
    });
    expect(conversationStatusUpdate('pending')).toEqual({
      status: 'pending',
      close_reason: null,
      close_note: null,
      closed_at: null,
    });
  });
});

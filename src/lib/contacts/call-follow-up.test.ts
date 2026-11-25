import { describe, expect, it } from 'vitest';

import {
  CALL_FOLLOW_UP_EVENT_TYPE,
  SCHEDULED_CALL_EVENT_TYPE,
  callFollowUpTitle,
  callLogPayload,
  scheduledCallTitle,
} from './call-follow-up';
import { EVENT_TYPE_ORDER } from '@/lib/calendar/event-type-defaults';

const calledAt = '2026-11-25T10:00:00.000Z';

describe('call follow-up', () => {
  it('[CTM-020] keeps trimmed notes and duration on a connected call', () => {
    expect(
      callLogPayload({
        outcome: 'connected',
        calledAt,
        notes: '  Wants 3BHK in Whitefield  ',
        durationMins: '2.5',
      })
    ).toEqual({
      direction: 'outbound',
      outcome: 'connected',
      called_at: calledAt,
      duration_seconds: 150,
      notes: 'Wants 3BHK in Whitefield',
    });
  });

  it('[CTM-020] stores blank notes and a bad duration as null', () => {
    const payload = callLogPayload({
      outcome: 'connected',
      calledAt,
      notes: '   ',
      durationMins: 'abc',
    });
    expect(payload.notes).toBeNull();
    expect(payload.duration_seconds).toBeNull();
  });

  it('[CTM-020] drops notes and duration from a call that did not connect', () => {
    const payload = callLogPayload({
      outcome: 'no_answer',
      calledAt,
      notes: 'left early',
      durationMins: 3,
    });
    expect(payload.notes).toBeNull();
    expect(payload.duration_seconds).toBeNull();
  });

  it('[CTM-020] titles the follow-up event after the contact', () => {
    expect(callFollowUpTitle({ name: ' Appa ', phone: '+919845475073' })).toBe(
      'Follow-up with Appa'
    );
    expect(callFollowUpTitle({ name: null, phone: '+919845475073' })).toBe(
      'Follow-up with +919845475073'
    );
    expect(EVENT_TYPE_ORDER).toContain(CALL_FOLLOW_UP_EVENT_TYPE);
  });

  it('[CTM-020] titles a scheduled call after the contact as a Call event', () => {
    expect(scheduledCallTitle({ name: 'Appa', phone: '+919845475073' })).toBe(
      'Call Appa'
    );
    expect(scheduledCallTitle({ name: '', phone: '+919845475073' })).toBe(
      'Call +919845475073'
    );
    expect(EVENT_TYPE_ORDER).toContain(SCHEDULED_CALL_EVENT_TYPE);
  });
});

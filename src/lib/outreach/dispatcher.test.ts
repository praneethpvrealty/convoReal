import { describe, expect, it } from 'vitest';
import {
  parsePostCallOpenReply,
  planSend,
  POST_CALL_OPEN_PREFIX,
} from '@/lib/outreach/dispatcher';

describe('planSend', () => {
  it('an opt-out beats everything, including an open window', () => {
    expect(
      planSend({
        action: 'matches',
        windowOpen: true,
        doNotCall: true,
        templateGate: 'ready',
      })
    ).toEqual({ mode: 'skip', reason: 'opted_out' });
  });

  it('an open window sends free-form, whatever the action', () => {
    for (const action of ['matches', 'note', 'handoff', 'checkin'] as const) {
      expect(
        planSend({
          action,
          windowOpen: true,
          doNotCall: false,
          templateGate: 'missing',
        })
      ).toEqual({ mode: 'freeform' });
    }
  });

  it('a note or handoff is never worth a template — shut window skips', () => {
    for (const action of ['note', 'handoff'] as const) {
      expect(
        planSend({
          action,
          windowOpen: false,
          doNotCall: false,
          templateGate: 'ready',
        })
      ).toEqual({ mode: 'skip', reason: 'window_shut' });
    }
  });

  it('matches and checkin ride the opener when it clears the gate', () => {
    for (const action of ['matches', 'checkin'] as const) {
      expect(
        planSend({
          action,
          windowOpen: false,
          doNotCall: false,
          templateGate: 'ready',
        })
      ).toEqual({ mode: 'opener' });
    }
  });

  it('records WHY the opener could not go, not just that it did not', () => {
    expect(
      planSend({
        action: 'matches',
        windowOpen: false,
        doNotCall: false,
        templateGate: 'marketing',
      })
    ).toEqual({ mode: 'skip', reason: 'opener_template_marketing' });
    expect(
      planSend({
        action: 'checkin',
        windowOpen: false,
        doNotCall: false,
        templateGate: 'missing',
      })
    ).toEqual({ mode: 'skip', reason: 'opener_template_missing' });
  });
});

describe('parsePostCallOpenReply', () => {
  it('extracts the follow-up id from the opener payload', () => {
    expect(parsePostCallOpenReply(`${POST_CALL_OPEN_PREFIX}abc-123`)).toBe(
      'abc-123'
    );
  });

  it('rejects other prefixes, bare prefixes, and empty ids', () => {
    expect(parsePostCallOpenReply('fup_checkin:abc')).toBeNull();
    expect(parsePostCallOpenReply(POST_CALL_OPEN_PREFIX)).toBeNull();
    expect(parsePostCallOpenReply('')).toBeNull();
    expect(parsePostCallOpenReply(null)).toBeNull();
  });
});

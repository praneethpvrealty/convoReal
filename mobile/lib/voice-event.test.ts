import { describe, it, expect } from 'vitest';
import {
  formatRecordingDuration,
  prefillFromParse,
  voiceHints,
  type ParsedEventResponse,
} from './voice-event';

function response(
  draft: Partial<ParsedEventResponse['draft']> = {},
  resolved: ParsedEventResponse['resolved'] = null
): ParsedEventResponse {
  return {
    draft: {
      intent: 'schedule',
      title: 'Site visit with Varun',
      event_type: 'site_visit',
      priority: 'medium',
      location: null,
      notes: null,
      transcript: null,
      contact_name: null,
      ...draft,
    },
    resolved,
  };
}

describe('prefillFromParse', () => {
  it('returns null when nothing schedulable was heard', () => {
    expect(prefillFromParse(response({ intent: 'none' }))).toBeNull();
  });

  it('maps a fully resolved parse into form values', () => {
    const parsed = response(
      { location: 'JP Nagar', transcript: 'site visit with varun tomorrow 4pm', notes: 'carry EC copy' },
      {
        start_time: '2026-08-01T10:30:00.000Z',
        end_time: '2026-08-01T11:30:00.000Z',
        contact: { id: 'c1', name: 'Varun', phone: '+919900112233', name_tag: 'Buyer' },
      }
    );
    const prefill = prefillFromParse(parsed);
    expect(prefill).not.toBeNull();
    expect(prefill!.title).toBe('Site visit with Varun');
    expect(prefill!.eventType).toBe('site_visit');
    expect(prefill!.start?.toISOString()).toBe('2026-08-01T10:30:00.000Z');
    expect(prefill!.location).toBe('JP Nagar');
    expect(prefill!.contact).toMatchObject({ id: 'c1', name: 'Varun', phone: '+919900112233' });
    expect(prefill!.description).toBe('carry EC copy');
    expect(prefill!.transcript).toBe('site visit with varun tomorrow 4pm');
    expect(prefill!.unmatchedContactName).toBeNull();
  });

  it('clamps event types the chips cannot display to meeting', () => {
    expect(prefillFromParse(response({ event_type: 'document' }))!.eventType).toBe('meeting');
    expect(prefillFromParse(response({ event_type: 'other' }))!.eventType).toBe('meeting');
    expect(prefillFromParse(response({ event_type: 'follow_up' }))!.eventType).toBe('follow_up');
  });

  it('keeps start null for task intent with no resolved time', () => {
    const prefill = prefillFromParse(response({ intent: 'task' }));
    expect(prefill!.start).toBeNull();
  });

  it('rejects an unparseable start time', () => {
    const prefill = prefillFromParse(
      response({}, { start_time: 'not-a-date', end_time: null, contact: null })
    );
    expect(prefill!.start).toBeNull();
  });

  it('surfaces the spoken contact name when it did not resolve', () => {
    const prefill = prefillFromParse(response({ contact_name: 'Varun' }));
    expect(prefill!.contact).toBeNull();
    expect(prefill!.unmatchedContactName).toBe('Varun');
  });
});

describe('voiceHints', () => {
  it('is empty for a complete prefill', () => {
    const prefill = prefillFromParse(
      response({}, {
        start_time: '2026-08-01T10:30:00.000Z',
        end_time: null,
        contact: { id: 'c1', name: 'Varun', phone: '+91' },
      })
    );
    expect(voiceHints(prefill!)).toEqual([]);
  });

  it('nudges for a missing time and an unmatched contact', () => {
    const prefill = prefillFromParse(response({ contact_name: 'Varun' }));
    const hints = voiceHints(prefill!);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toMatch(/No date or time/);
    expect(hints[1]).toMatch(/"Varun"/);
  });
});

describe('formatRecordingDuration', () => {
  it('formats mm:ss', () => {
    expect(formatRecordingDuration(0)).toBe('0:00');
    expect(formatRecordingDuration(9_500)).toBe('0:09');
    expect(formatRecordingDuration(83_000)).toBe('1:23');
  });
});

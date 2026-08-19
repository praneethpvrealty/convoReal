import { describe, it, expect } from 'vitest';
import {
  dedupeConsecutiveEvents,
  formatDwellTime,
  groupEventsByVisitor,
  type PulseEvent,
} from './pulse-feed';

function evt(
  overrides: Partial<PulseEvent> & { id: string; created_at: string }
): PulseEvent {
  return {
    contact_id: null,
    contact: null,
    property_id: null,
    property: null,
    session_key: 'sess-1',
    event_type: 'open',
    metadata: {},
    ...overrides,
  };
}

describe('dedupeConsecutiveEvents', () => {
  it('collapses consecutive identical events (same session/type/property) within the window', () => {
    const feed = [
      evt({ id: '3', created_at: '2026-01-01T00:02:00Z' }),
      evt({ id: '2', created_at: '2026-01-01T00:01:00Z' }),
      evt({ id: '1', created_at: '2026-01-01T00:00:00Z' }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
    expect(result[0].repeatCount).toBe(3);
  });

  it('does not merge across different sessions', () => {
    const feed = [
      evt({
        id: '2',
        created_at: '2026-01-01T00:01:00Z',
        session_key: 'sess-2',
      }),
      evt({
        id: '1',
        created_at: '2026-01-01T00:00:00Z',
        session_key: 'sess-1',
      }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.repeatCount === 1)).toBe(true);
  });

  it('does not merge across different event types or properties', () => {
    const feed = [
      evt({
        id: '3',
        created_at: '2026-01-01T00:02:00Z',
        event_type: 'view_property',
        property_id: 'p-2',
      }),
      evt({
        id: '2',
        created_at: '2026-01-01T00:01:00Z',
        event_type: 'view_property',
        property_id: 'p-1',
      }),
      evt({ id: '1', created_at: '2026-01-01T00:00:00Z', event_type: 'open' }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.repeatCount === 1)).toBe(true);
  });

  it('does not merge repeats outside the 5-minute window', () => {
    const feed = [
      evt({ id: '2', created_at: '2026-01-01T00:10:00Z' }),
      evt({ id: '1', created_at: '2026-01-01T00:00:00Z' }),
    ];
    expect(dedupeConsecutiveEvents(feed)).toHaveLength(2);
  });

  it('does not merge non-consecutive matching events separated by a different one', () => {
    const feed = [
      evt({ id: '3', created_at: '2026-01-01T00:02:00Z' }),
      evt({
        id: '2',
        created_at: '2026-01-01T00:01:00Z',
        event_type: 'view_property',
        property_id: 'p-1',
      }),
      evt({ id: '1', created_at: '2026-01-01T00:00:00Z' }),
    ];
    const result = dedupeConsecutiveEvents(feed);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.repeatCount === 1)).toBe(true);
  });

  it('does not mutate the events it was given', () => {
    const source = evt({ id: '1', created_at: '2026-01-01T00:00:00Z' });
    dedupeConsecutiveEvents([
      source,
      evt({ id: '2', created_at: '2026-01-01T00:01:00Z' }),
    ]);
    expect('repeatCount' in source).toBe(false);
  });

  it('returns an empty array for an empty feed', () => {
    expect(dedupeConsecutiveEvents([])).toEqual([]);
  });
});

describe('formatDwellTime', () => {
  it('renders seconds under a minute', () => {
    expect(formatDwellTime(45_000)).toBe('45s dwell');
  });

  it('renders minutes and seconds past a minute', () => {
    expect(formatDwellTime(130_000)).toBe('2m 10s dwell');
  });

  it('drops the seconds on a whole minute', () => {
    expect(formatDwellTime(120_000)).toBe('2m dwell');
  });

  it('renders nothing when the beacon carried no duration', () => {
    expect(formatDwellTime()).toBe('');
    expect(formatDwellTime(0)).toBe('');
    expect(formatDwellTime(Number.NaN)).toBe('');
  });
});

describe('groupEventsByVisitor', () => {
  it('groups every session belonging to the same identified contact', () => {
    const contact = {
      id: 'contact-1',
      name: 'Suleman',
      phone: '9999999999',
      name_tag: 'Btm',
    };
    const events = dedupeConsecutiveEvents([
      evt({
        id: '3',
        created_at: '2026-01-01T00:03:00Z',
        session_key: 'sess-2',
        contact,
      }),
      evt({
        id: '2',
        created_at: '2026-01-01T00:02:00Z',
        session_key: 'sess-1',
        contact,
      }),
    ]);

    const result = groupEventsByVisitor(events);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('contact:contact-1');
    expect(result[0].latestEvent.id).toBe('3');
    expect(result[0].events).toHaveLength(2);
  });

  it('keeps unrelated anonymous sessions in separate visitor cards', () => {
    const events = dedupeConsecutiveEvents([
      evt({
        id: '2',
        created_at: '2026-01-01T00:02:00Z',
        session_key: 'sess-2',
      }),
      evt({
        id: '1',
        created_at: '2026-01-01T00:01:00Z',
        session_key: 'sess-1',
      }),
    ]);

    expect(groupEventsByVisitor(events)).toHaveLength(2);
  });

  it('includes collapsed repeats in the activity count', () => {
    const events = dedupeConsecutiveEvents([
      evt({ id: '2', created_at: '2026-01-01T00:02:00Z' }),
      evt({ id: '1', created_at: '2026-01-01T00:01:00Z' }),
    ]);

    expect(groupEventsByVisitor(events)[0].activityCount).toBe(2);
  });
});

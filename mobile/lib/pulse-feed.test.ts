import { describe, it, expect } from 'vitest';
import {
  dedupeConsecutiveEvents,
  formatDwellTime,
  groupEventsByVisitor,
  nextPulseFeedCursor,
  PULSE_FEED_PAGE_SIZE,
  pulseFeedCursorFilter,
  pulseVisitorLabel,
  visitorContactRoute,
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

  it('keeps different search strings as separate activity', () => {
    const feed = [
      evt({
        id: '2',
        created_at: '2026-01-01T00:01:00Z',
        event_type: 'search',
        metadata: { query: 'Domlur commercial building' },
      }),
      evt({
        id: '1',
        created_at: '2026-01-01T00:00:00Z',
        event_type: 'search',
        metadata: { query: 'Indiranagar showroom' },
      }),
    ];

    expect(dedupeConsecutiveEvents(feed)).toHaveLength(2);
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

describe('[PLS-001] pulse feed paging', () => {
  it('keeps paging past a single busy day instead of stopping at one window', () => {
    const page = Array.from({ length: PULSE_FEED_PAGE_SIZE }, (_, i) => ({
      id: `evt-${i}`,
      created_at: `2026-09-25T${String(23 - (i % 24)).padStart(2, '0')}:00:00+00:00`,
    }));
    expect(nextPulseFeedCursor(page)).toEqual({
      id: page[page.length - 1].id,
      createdAt: page[page.length - 1].created_at,
    });
  });

  it('stops once a page comes back short', () => {
    expect(
      nextPulseFeedCursor([{ id: 'a', created_at: '2026-09-20T00:00:00Z' }])
    ).toBeNull();
  });

  it('breaks timestamp ties by id so events sharing a second are not skipped', () => {
    expect(
      pulseFeedCursorFilter({
        createdAt: '2026-09-25T10:00:00+00:00',
        id: 'b7',
      })
    ).toBe(
      'created_at.lt.2026-09-25T10:00:00+00:00,and(created_at.eq.2026-09-25T10:00:00+00:00,id.lt.b7)'
    );
  });
});

describe('[PLS-002] visitor contact link', () => {
  it('opens the identified visitor’s contact screen', () => {
    expect(
      visitorContactRoute({
        contact: { id: 'c-42', name: 'Pramod', phone: null, name_tag: null },
      })
    ).toBe('/(app)/contact/c-42');
  });

  it('gives an anonymous guest no link', () => {
    expect(visitorContactRoute({ contact: null })).toBeNull();
  });
});

describe('[PLS-003] visitor label', () => {
  const timeAgo = () => '2h ago';
  const session = 'e3e4ba9d-1234-4abc-8def-000000000000';

  it('names an identified visitor', () => {
    expect(
      pulseVisitorLabel(
        {
          contact: { id: 'c-1', name: 'Salman', phone: '+91', name_tag: null },
          via_contact: null,
          share: null,
          session_key: session,
        },
        timeAgo
      )
    ).toBe('Salman');
  });

  it('labels a forwarded-link viewer as a guest via the sender, never as the sender', () => {
    const label = pulseVisitorLabel(
      {
        contact: null,
        via_contact: { id: 'c-1', name: 'Ravi', phone: '+91' },
        share: null,
        session_key: session,
      },
      timeAgo
    );
    expect(label).toBe("Guest via Ravi's link · e3e4ba9d");
    expect(label).not.toBe('Ravi');
  });

  it('dates a generic-share guest to the share', () => {
    expect(
      pulseVisitorLabel(
        {
          contact: null,
          via_contact: null,
          share: { id: 's-1', created_at: '2026-09-26T10:00:00Z' },
          session_key: session,
        },
        timeAgo
      )
    ).toBe('Guest · link shared 2h ago · e3e4ba9d');
  });

  it('falls back to an anonymous guest', () => {
    expect(
      pulseVisitorLabel(
        { contact: null, via_contact: null, share: null, session_key: session },
        timeAgo
      )
    ).toBe('Anonymous guest · e3e4ba9d');
  });
});

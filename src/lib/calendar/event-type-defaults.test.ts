import { describe, expect, it } from 'vitest';

import {
  EVENT_TYPE_KEYS,
  EVENT_TYPES,
} from '@/components/calendar/event-types';

import {
  DEFAULT_EVENT_TYPE,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  eventTypeFromParam,
} from './event-type-defaults';

describe('[UIX-003] event type defaults shared by web and mobile', () => {
  it('lists the web picker types in the web picker order', () => {
    expect([...EVENT_TYPE_ORDER]).toEqual(EVENT_TYPE_KEYS);
  });

  it('labels every type once, the way both surfaces show it', () => {
    expect(EVENT_TYPE_ORDER.map((t) => EVENT_TYPE_LABELS[t])).toEqual([
      'Site visit',
      'Call',
      'Follow-up',
      'Documents',
      'Meeting',
      'Other',
    ]);
    expect(EVENT_TYPE_KEYS.map((k) => EVENT_TYPES[k].label)).toEqual(
      EVENT_TYPE_ORDER.map((t) => EVENT_TYPE_LABELS[t])
    );
  });

  it('starts a new event as a meeting unless a known type is passed', () => {
    expect(DEFAULT_EVENT_TYPE).toBe('meeting');
    expect(eventTypeFromParam(undefined)).toBe('meeting');
    expect(eventTypeFromParam('follow_up')).toBe('follow_up');
    expect(eventTypeFromParam('nonsense')).toBe('meeting');
  });
});

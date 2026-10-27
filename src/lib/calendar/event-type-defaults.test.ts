import { describe, expect, it } from 'vitest';

import { EVENT_TYPE_KEYS } from '@/components/calendar/event-types';

import {
  DEFAULT_EVENT_TYPE,
  EVENT_TYPE_ORDER,
  eventTypeFromParam,
} from './event-type-defaults';

describe('[UIX-003] event type defaults shared by web and mobile', () => {
  it('lists the web picker types in the web picker order', () => {
    expect([...EVENT_TYPE_ORDER]).toEqual(EVENT_TYPE_KEYS);
  });

  it('starts a new event as a meeting unless a known type is passed', () => {
    expect(DEFAULT_EVENT_TYPE).toBe('meeting');
    expect(eventTypeFromParam(undefined)).toBe('meeting');
    expect(eventTypeFromParam('follow_up')).toBe('follow_up');
    expect(eventTypeFromParam('nonsense')).toBe('meeting');
  });
});

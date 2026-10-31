import { describe, expect, it } from 'vitest';

import { notificationTarget } from '@/lib/notification-target';

const row = (overrides: Partial<Parameters<typeof notificationTarget>[0]>) => ({
  type: 'new_message',
  entity_type: null,
  entity_id: null,
  link: null,
  ...overrides,
});

describe('[UIX-010] notification rows open where they point', () => {
  it('opens the conversation, contact or property the row names', () => {
    expect(
      notificationTarget(row({ entity_type: 'conversation', entity_id: 'c1' }))
    ).toBe('/(app)/conversation/c1');
    expect(
      notificationTarget(row({ entity_type: 'contact', entity_id: 'p1' }))
    ).toBe('/(app)/contact/p1');
    expect(
      notificationTarget(row({ entity_type: 'property', entity_id: 'h1' }))
    ).toBe('/(app)/property/h1');
  });

  it('sends appointment notices to the calendar', () => {
    expect(notificationTarget(row({ type: 'appointment_reminder' }))).toBe(
      '/(app)/(tabs)/calendar'
    );
    expect(notificationTarget(row({ link: '/calendar?event=1' }))).toBe(
      '/(app)/(tabs)/calendar'
    );
  });

  it('reads a conversation id out of a web link', () => {
    expect(
      notificationTarget(row({ link: '/inbox?conversation=ab12-cd34' }))
    ).toBe('/(app)/conversation/ab12-cd34');
  });

  it('returns null for a row that points nowhere', () => {
    expect(notificationTarget(row({ type: 'daily_digest' }))).toBeNull();
  });
});

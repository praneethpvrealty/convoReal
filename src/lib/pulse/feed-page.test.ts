import { describe, expect, it } from 'vitest';
import {
  PULSE_FEED_PAGE_SIZE,
  nextPulseFeedCursor,
  pulseFeedCursorFilter,
} from './feed-page';

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
    expect(nextPulseFeedCursor([])).toBeNull();
  });

  it('breaks timestamp ties by id so events sharing a second are not skipped', () => {
    expect(
      pulseFeedCursorFilter({
        createdAt: '2026-09-25T10:00:00.123456+00:00',
        id: 'b7',
      })
    ).toBe(
      'created_at.lt.2026-09-25T10:00:00.123456+00:00,and(created_at.eq.2026-09-25T10:00:00.123456+00:00,id.lt.b7)'
    );
  });
});

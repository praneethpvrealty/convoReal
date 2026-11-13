import { describe, expect, it } from 'vitest';
import {
  recentShareNotice,
  recentShareRefusal,
  recentShareSince,
  sharedAgoLabel,
} from './recent-share';

const NOW = new Date('2026-11-13T13:01:30.000Z');

describe('recent-share', () => {
  it('[PRP-061] looks back exactly 24 hours', () => {
    expect(recentShareSince(NOW)).toBe('2026-11-12T13:01:30.000Z');
  });

  it('[PRP-061] says how long ago the listing went out', () => {
    expect(sharedAgoLabel('2026-11-13T13:01:10.000Z', NOW)).toBe('just now');
    expect(sharedAgoLabel('2026-11-13T13:00:00.000Z', NOW)).toBe('1 min ago');
    expect(sharedAgoLabel('2026-11-13T12:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(sharedAgoLabel('2026-11-13T03:00:00.000Z', NOW)).toBe(
      '10 hours ago'
    );
    expect(recentShareNotice('Karthik', '2026-11-13T13:00:00.000Z', NOW)).toBe(
      'Karthik already got this listing 1 min ago.'
    );
  });

  it('[PRP-061] reads the refusal a client got back, and only that refusal', () => {
    expect(
      recentShareRefusal('RECENTLY_SHARED', {
        shared_at: '2026-11-13T13:00:00.000Z',
      })
    ).toEqual({ sharedAt: '2026-11-13T13:00:00.000Z' });
    expect(recentShareRefusal('RECENTLY_SHARED', undefined)).toEqual({
      sharedAt: null,
    });
    expect(recentShareRefusal('BROKERAGE_REQUIRED', {})).toBeNull();
  });
});

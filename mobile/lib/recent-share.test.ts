import { describe, expect, it } from 'vitest';
import {
  recentShareNotice,
  recentShareRefusal,
} from '@shared/lib/inventory/recent-share';

describe('recent share refusal on mobile', () => {
  it('[PRP-061] reads the server refusal into the resend prompt', () => {
    const refusal = recentShareRefusal('RECENTLY_SHARED', {
      shared_at: '2026-11-13T13:00:00.000Z',
    });
    expect(refusal).toEqual({ sharedAt: '2026-11-13T13:00:00.000Z' });
    expect(
      recentShareNotice(
        'Karthik',
        refusal!.sharedAt!,
        new Date('2026-11-13T13:01:30.000Z')
      )
    ).toBe('Karthik already got this listing 1 min ago.');
  });
});

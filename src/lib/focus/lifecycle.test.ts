import { describe, expect, it } from 'vitest';

import { isLiveJourneyState } from './lifecycle';

describe('[JRN-011] Focus counts only journeys the overview shows as active', () => {
  it('treats a journey with no state row as live', () => {
    expect(isLiveJourneyState(undefined)).toBe(true);
    expect(isLiveJourneyState(null)).toBe(true);
  });

  it('keeps an active, unarchived journey', () => {
    expect(
      isLiveJourneyState({ lifecycle_status: 'active', archived_at: null })
    ).toBe(true);
  });

  it('drops a closed or archived journey', () => {
    expect(
      isLiveJourneyState({ lifecycle_status: 'completed', archived_at: null })
    ).toBe(false);
    expect(
      isLiveJourneyState({ lifecycle_status: 'paused', archived_at: null })
    ).toBe(false);
    expect(
      isLiveJourneyState({
        lifecycle_status: 'not_proceeding',
        archived_at: null,
      })
    ).toBe(false);
    expect(
      isLiveJourneyState({
        lifecycle_status: 'active',
        archived_at: '2026-09-26T00:00:00Z',
      })
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  exceedsPropertyVideoUploadCeiling,
  PROPERTY_VIDEO_PREMIUM_MAX_BYTES,
} from './property-video-limits';

describe('property video preflight limit', () => {
  it('does not deny a paid-size file before the server checks the plan', () => {
    expect(exceedsPropertyVideoUploadCeiling(16 * 1024 * 1024 + 1)).toBe(false);
    expect(
      exceedsPropertyVideoUploadCeiling(PROPERTY_VIDEO_PREMIUM_MAX_BYTES)
    ).toBe(false);
  });

  it('rejects files above the maximum offered by any plan', () => {
    expect(
      exceedsPropertyVideoUploadCeiling(PROPERTY_VIDEO_PREMIUM_MAX_BYTES + 1)
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { propertyVideoLimitCopy } from './property-video';

describe('propertyVideoLimitCopy', () => {
  it('does not claim a Starter limit while the plan lookup is unavailable', () => {
    expect(propertyVideoLimitCopy(null)).toBe(
      'Upload one MP4 — limit checked for your plan'
    );
  });

  it('shows the server-provided plan limit', () => {
    expect(propertyVideoLimitCopy(100 * 1024 * 1024)).toBe(
      'Upload one MP4 up to 100 MB'
    );
  });
});

import { describe, expect, it } from 'vitest';
import { propertyVideoUploadFingerprint } from './property-video-upload';

describe('propertyVideoUploadFingerprint', () => {
  const file = { name: 'tour.mp4', size: 20_000_000, type: 'video/mp4' };

  it('does not resume a previous upload under a newly allocated path', () => {
    expect(propertyVideoUploadFingerprint('account/one.mp4', file)).not.toBe(
      propertyVideoUploadFingerprint('account/two.mp4', file)
    );
  });
});

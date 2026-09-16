import { describe, expect, it } from 'vitest';
import { propertyVideoUploadFingerprint } from './property-video-resumable';

describe('propertyVideoUploadFingerprint', () => {
  const file = { name: 'tour.mp4', size: 20_000_000, type: 'video/mp4' };

  it('binds resumable state to the server-authorized object path', () => {
    expect(propertyVideoUploadFingerprint('account/one.mp4', file)).not.toBe(
      propertyVideoUploadFingerprint('account/two.mp4', file)
    );
  });
});

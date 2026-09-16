import { describe, expect, it } from 'vitest';
import {
  PROPERTY_VIDEO_MAX_BYTES,
  PROPERTY_VIDEO_PREMIUM_MAX_BYTES,
  propertyVideoMaxBytes,
  rejectPropertyVideo,
} from './property-video';

describe('[MED-001] rejectPropertyVideo', () => {
  it('accepts an MP4 at the WhatsApp-compatible ceiling', () => {
    expect(
      rejectPropertyVideo('video/mp4', PROPERTY_VIDEO_MAX_BYTES)
    ).toBeNull();
  });

  it('accepts an MP4 mime type with a codec parameter', () => {
    expect(rejectPropertyVideo('video/mp4; codecs=h264', 1024)).toBeNull();
  });

  it('rejects other video containers', () => {
    expect(rejectPropertyVideo('video/quicktime', 1024)).toMatchObject({
      code: 'UNSUPPORTED_VIDEO_TYPE',
      status: 415,
    });
  });

  it('rejects MP4 files over 16 MB', () => {
    expect(
      rejectPropertyVideo('video/mp4', PROPERTY_VIDEO_MAX_BYTES + 1)
    ).toMatchObject({ code: 'VIDEO_TOO_LARGE', status: 413 });
  });

  it.each(['solo_pro', 'team', 'agency'] as const)(
    'gives the %s plan a 100 MB walkthrough limit',
    (plan) => {
      expect(propertyVideoMaxBytes(plan)).toBe(
        PROPERTY_VIDEO_PREMIUM_MAX_BYTES
      );
      expect(
        rejectPropertyVideo(
          'video/mp4',
          PROPERTY_VIDEO_PREMIUM_MAX_BYTES,
          propertyVideoMaxBytes(plan)
        )
      ).toBeNull();
    }
  );

  it('keeps Starter at 16 MB', () => {
    expect(propertyVideoMaxBytes('starter')).toBe(PROPERTY_VIDEO_MAX_BYTES);
  });
});

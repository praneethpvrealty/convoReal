import { describe, expect, it } from 'vitest';
import {
  PROPERTY_VIDEO_MAX_BYTES,
  rejectPropertyVideo,
} from './property-video';

describe('rejectPropertyVideo', () => {
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
});

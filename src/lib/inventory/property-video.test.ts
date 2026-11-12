import { describe, expect, it } from 'vitest';
import {
  PROPERTY_VIDEO_MAX_BYTES,
  PROPERTY_VIDEO_PREMIUM_MAX_BYTES,
  isStorageTooLargeError,
  propertyVideoMaxBytes,
  rejectPropertyVideo,
  rejectPropertyVideoPreflight,
  walkthroughDroppedNote,
  walkthroughTooLargeReply,
  walkthroughUploadFailedReply,
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

  it('lets the server authorize plan-specific sizes after a limit lookup failure', () => {
    expect(
      rejectPropertyVideoPreflight('video/mp4', PROPERTY_VIDEO_MAX_BYTES + 1)
    ).toBeNull();
    expect(
      rejectPropertyVideoPreflight(
        'video/mp4',
        PROPERTY_VIDEO_PREMIUM_MAX_BYTES + 1
      )
    ).toMatchObject({ code: 'VIDEO_TOO_LARGE', status: 413 });
  });
});

describe('[MED-003] WhatsApp walkthrough size replies', () => {
  const MB = 1024 * 1024;

  it('names the file size and the plan limit when a walkthrough is too large', () => {
    const reply = walkthroughTooLargeReply(
      54 * MB,
      PROPERTY_VIDEO_PREMIUM_MAX_BYTES
    );
    expect(reply).toContain('54 MB');
    expect(reply).toContain('up to 100 MB');
    expect(reply).not.toContain('16MB');
  });

  it('recognises a storage size refusal', () => {
    expect(
      isStorageTooLargeError(
        new Error(
          'Storage video upload failed: The object exceeded the maximum allowed size'
        )
      )
    ).toBe(true);
    expect(isStorageTooLargeError(new Error('Payload too large'))).toBe(true);
    expect(isStorageTooLargeError(new Error('fetch failed'))).toBe(false);
  });

  it('reports a storage size refusal as too large, with the plan limit', () => {
    const reply = walkthroughUploadFailedReply(
      new Error('The object exceeded the maximum allowed size'),
      54 * MB,
      PROPERTY_VIDEO_PREMIUM_MAX_BYTES
    );
    expect(reply).toContain('too large to store');
    expect(reply).toContain('54 MB');
    expect(reply).toContain('up to 100 MB');
  });

  it('reports any other failure with the plan limit rather than a fixed 16 MB', () => {
    const starter = walkthroughUploadFailedReply(
      new Error('fetch failed'),
      3 * MB,
      PROPERTY_VIDEO_MAX_BYTES
    );
    expect(starter).toContain('Failed to upload video');
    expect(starter).toContain('up to 16 MB');
    expect(
      walkthroughUploadFailedReply(
        new Error('fetch failed'),
        3 * MB,
        PROPERTY_VIDEO_PREMIUM_MAX_BYTES
      )
    ).toContain('up to 100 MB');
  });

  it('adds a dropped-video note to a fresh draft only when a video was dropped', () => {
    expect(walkthroughDroppedNote(null, PROPERTY_VIDEO_MAX_BYTES)).toBe('');
    const note = walkthroughDroppedNote(54 * MB, PROPERTY_VIDEO_MAX_BYTES);
    expect(note).toContain('54 MB video was too large to store');
    expect(note).toContain('limit 16 MB');
    expect(note).toContain('no walkthrough yet');
  });

  it('tells a fresh draft an upload failure apart from an oversized file', () => {
    const note = walkthroughDroppedNote(
      10 * MB,
      PROPERTY_VIDEO_PREMIUM_MAX_BYTES,
      'failed'
    );
    expect(note).toContain('could not be uploaded');
    expect(note).toContain('Send it again');
    expect(note).not.toContain('too large');
  });

  it('rounds a refused size up so it never reads as equal to the limit', () => {
    const reply = walkthroughTooLargeReply(
      17_196_646,
      PROPERTY_VIDEO_MAX_BYTES
    );
    expect(reply).toContain('This one is 17 MB');
    expect(reply).toContain('up to 16 MB');
  });
});

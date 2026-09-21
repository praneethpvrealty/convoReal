import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_TEMPLATE_NAME,
  ANNOUNCEMENT_TEMPLATE_NAMES,
  LEGACY_ANNOUNCEMENT_TEMPLATE_NAMES,
  buildAnnouncementTemplatePayload,
  pickAnnouncementTemplate,
} from './announcement-template';
import { validateTemplatePayload } from './template-validators';

describe('announcement template', () => {
  it('submits under the video name with a video header', () => {
    const payload = buildAnnouncementTemplatePayload(
      'https://www.convoreal.com/'
    );
    expect(payload.name).toBe('announcement_video_notice');
    expect(payload.header_type).toBe('video');
    expect(payload.header_media_url).toBe(
      'https://www.convoreal.com/brand/announcement-sample.mp4'
    );
    expect(() => validateTemplatePayload(payload)).not.toThrow();
  });

  it('keeps the legacy audio name as a send candidate', () => {
    expect(ANNOUNCEMENT_TEMPLATE_NAMES).toEqual([
      'announcement_video_notice',
      'audio_announcement_notice',
    ]);
    expect(LEGACY_ANNOUNCEMENT_TEMPLATE_NAMES).toEqual([
      'audio_announcement_notice',
    ]);
  });

  it('sends on the approved legacy row until the renamed one is approved', () => {
    const rows = [
      { name: ANNOUNCEMENT_TEMPLATE_NAME, status: 'PENDING' },
      { name: 'audio_announcement_notice', status: 'APPROVED' },
    ];
    expect(pickAnnouncementTemplate(rows)?.name).toBe(
      'audio_announcement_notice'
    );
  });

  it('prefers the renamed row once both are approved', () => {
    const rows = [
      { name: 'audio_announcement_notice', status: 'APPROVED' },
      { name: ANNOUNCEMENT_TEMPLATE_NAME, status: 'APPROVED' },
    ];
    expect(pickAnnouncementTemplate(rows)?.name).toBe(
      'announcement_video_notice'
    );
  });

  it('returns nothing when neither row is approved', () => {
    expect(
      pickAnnouncementTemplate([
        { name: ANNOUNCEMENT_TEMPLATE_NAME, status: 'REJECTED' },
      ])
    ).toBeNull();
  });
});

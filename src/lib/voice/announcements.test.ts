import { describe, expect, it } from 'vitest';
import {
  accumulateSendCounts,
  announcementDeliveryFor,
  emptySendCounts,
  isUpdateChannel,
  parseUpdateChannelReplyId,
  updateChannelConfirmation,
  updateChannelReplyId,
} from './announcements';

describe('isUpdateChannel', () => {
  it('accepts only the three channels', () => {
    expect(isUpdateChannel('whatsapp_text')).toBe(true);
    expect(isUpdateChannel('whatsapp_audio')).toBe(true);
    expect(isUpdateChannel('voice_call')).toBe(true);
    expect(isUpdateChannel('email')).toBe(false);
    expect(isUpdateChannel(null)).toBe(false);
  });
});

describe('announcementDeliveryFor', () => {
  it('skips voice-call contacts regardless of window', () => {
    expect(announcementDeliveryFor('voice_call', 'whatsapp_audio', true)).toBe(
      'skipped_voice_pref'
    );
    expect(announcementDeliveryFor('voice_call', 'whatsapp_audio', false)).toBe(
      'skipped_voice_pref'
    );
  });

  it('skips closed windows for every message channel', () => {
    expect(announcementDeliveryFor(null, 'whatsapp_audio', false)).toBe(
      'skipped_window'
    );
    expect(
      announcementDeliveryFor('whatsapp_text', 'whatsapp_audio', false)
    ).toBe('skipped_window');
  });

  it('lets an explicit preference beat the sender default', () => {
    expect(
      announcementDeliveryFor('whatsapp_text', 'whatsapp_audio', true)
    ).toBe('text');
    expect(
      announcementDeliveryFor('whatsapp_audio', 'whatsapp_text', true)
    ).toBe('audio');
  });

  it('applies the sender default when no preference is stated', () => {
    expect(announcementDeliveryFor(null, 'whatsapp_audio', true)).toBe('audio');
    expect(announcementDeliveryFor(null, 'whatsapp_text', true)).toBe('text');
  });

  it('falls back to the video template for closed-window audio recipients', () => {
    expect(announcementDeliveryFor(null, 'whatsapp_audio', false, true)).toBe(
      'video_template'
    );
    expect(
      announcementDeliveryFor('whatsapp_audio', 'whatsapp_text', false, true)
    ).toBe('video_template');
    // Text-channel recipients get no video; without the template nobody does.
    expect(
      announcementDeliveryFor('whatsapp_text', 'whatsapp_audio', false, true)
    ).toBe('skipped_window');
    expect(announcementDeliveryFor(null, 'whatsapp_audio', false, false)).toBe(
      'skipped_window'
    );
  });
});

describe('update-channel reply ids', () => {
  it('round-trips each channel and rejects everything else', () => {
    expect(
      parseUpdateChannelReplyId(updateChannelReplyId('whatsapp_audio'))
    ).toBe('whatsapp_audio');
    expect(parseUpdateChannelReplyId(updateChannelReplyId('voice_call'))).toBe(
      'voice_call'
    );
    expect(parseUpdateChannelReplyId('updch:email')).toBeNull();
    expect(parseUpdateChannelReplyId('enq_approve:123')).toBeNull();
  });

  it('confirms each channel in plain words', () => {
    expect(updateChannelConfirmation('whatsapp_audio')).toContain(
      'voice notes'
    );
    expect(updateChannelConfirmation('voice_call')).toContain('call');
    expect(updateChannelConfirmation('whatsapp_text')).toContain('text');
  });
});

describe('accumulateSendCounts', () => {
  it('merges onto empty or partial stored counts', () => {
    const run = { ...emptySendCounts(), audio: 2, skipped_window: 1 };
    expect(accumulateSendCounts(null, run)).toEqual({
      audio: 2,
      text: 0,
      video_template: 0,
      skipped_voice_pref: 0,
      skipped_window: 1,
      failed: 0,
    });
    expect(accumulateSendCounts({ audio: 3, text: 1 }, run)).toEqual({
      audio: 5,
      text: 1,
      video_template: 0,
      skipped_voice_pref: 0,
      skipped_window: 1,
      failed: 0,
    });
  });
});

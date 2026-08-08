import { describe, expect, it } from 'vitest';
import { isReplayable, mediaIdFromUrl, replayText } from './message-replay';

describe('mediaIdFromUrl', () => {
  it('recovers the media id from the stored proxy path', () => {
    expect(mediaIdFromUrl('/api/whatsapp/media/1234567890')).toBe('1234567890');
  });

  it('ignores anything that is not our proxy path', () => {
    // A Supabase Storage URL belongs to an outbound message and cannot
    // be re-fetched from Meta.
    expect(
      mediaIdFromUrl('https://xyz.supabase.co/storage/v1/object/public/x.jpg')
    ).toBeNull();
    expect(mediaIdFromUrl('https://lookaside.fbsbx.com/whatsapp/123')).toBeNull();
    expect(mediaIdFromUrl(null)).toBeNull();
    expect(mediaIdFromUrl('')).toBeNull();
  });

  it('does not take a query string or a deeper path as the id', () => {
    expect(mediaIdFromUrl('/api/whatsapp/media/123/raw')).toBeNull();
    expect(mediaIdFromUrl('/api/whatsapp/media/123?download=1')).toBeNull();
  });
});

describe('isReplayable', () => {
  it('accepts a forwarded listing text', () => {
    expect(
      isReplayable({
        content_type: 'text',
        content_text: '3BHK in HSR, 1.4 Cr, 1450 sqft',
        media_url: null,
      })
    ).toBe(true);
  });

  it('accepts a photo or PDF with no caption', () => {
    for (const content_type of ['image', 'document', 'video']) {
      expect(
        isReplayable({
          content_type,
          content_text: null,
          media_url: '/api/whatsapp/media/999',
        }),
        content_type
      ).toBe(true);
    }
  });

  it('refuses a message with nothing to re-read', () => {
    expect(
      isReplayable({ content_type: 'text', content_text: '   ', media_url: null })
    ).toBe(false);
    expect(
      isReplayable({ content_type: 'image', content_text: null, media_url: null })
    ).toBe(false);
  });

  it('refuses a voice note — there is no stored transcript to replay', () => {
    expect(
      isReplayable({
        content_type: 'audio',
        content_text: null,
        media_url: '/api/whatsapp/media/999',
      })
    ).toBe(false);
  });

  it('refuses types the intake never reads', () => {
    expect(
      isReplayable({
        content_type: 'location',
        content_text: 'Pin',
        media_url: null,
      })
    ).toBe(false);
  });
});

describe('replayText', () => {
  it('keeps the original listing and the reply that pointed at it', () => {
    expect(replayText('3BHK in HSR, 1.4 Cr', 'add this one')).toBe(
      '3BHK in HSR, 1.4 Cr\nadd this one'
    );
  });

  it('carries a correction typed on the reply', () => {
    // The whole reason both travel: the reply is where "but it is 1.2cr
    // now" arrives.
    expect(replayText('3BHK in HSR, 1.4 Cr', "save it, but it's 1.2cr now")).toContain(
      "1.2cr now"
    );
  });

  it('is just the original when the reply carried no words', () => {
    expect(replayText('3BHK in HSR', '')).toBe('3BHK in HSR');
    expect(replayText('3BHK in HSR', null)).toBe('3BHK in HSR');
  });

  it('is just the reply when the original was media with no caption', () => {
    expect(replayText(null, 'add this')).toBe('add this');
  });
});

import { describe, expect, it } from 'vitest';

import { ONBOARDING_MEDIA, getOnboardingMedia, toEmbedUrl } from './media';

describe('toEmbedUrl', () => {
  it('converts watch URLs', () => {
    expect(toEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
  });

  it('converts youtu.be short links', () => {
    expect(toEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
  });

  it('converts shorts and passes embeds through normalised', () => {
    expect(toEmbedUrl('https://youtube.com/shorts/abc123XYZ_-')).toBe(
      'https://www.youtube.com/embed/abc123XYZ_-'
    );
    expect(toEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
  });

  it('rejects non-YouTube, non-https and malformed URLs', () => {
    expect(toEmbedUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(toEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(toEmbedUrl('not a url')).toBeNull();
    expect(toEmbedUrl('https://www.youtube.com/watch?v=<script>')).toBeNull();
  });
});

describe('getOnboardingMedia', () => {
  it('returns an entry for every registered slug', () => {
    for (const slug of Object.keys(ONBOARDING_MEDIA)) {
      const media = getOnboardingMedia(slug as keyof typeof ONBOARDING_MEDIA);
      expect(media).toHaveProperty('videoUrl');
      expect(media).toHaveProperty('caption');
    }
  });

  it('registered video URLs must be embeddable', () => {
    for (const [slug, media] of Object.entries(ONBOARDING_MEDIA)) {
      if (media.videoUrl) {
        expect(
          toEmbedUrl(media.videoUrl),
          `bad videoUrl for ${slug}`
        ).not.toBeNull();
      }
    }
  });
});

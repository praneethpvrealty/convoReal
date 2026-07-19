import { describe, expect, it } from 'vitest';
import { buildVideoMetadata } from './upload';
import { isAuthError, YouTubeApiError } from './client';

describe('buildVideoMetadata', () => {
  it('joins title and locality, preferring sublocality + city', () => {
    const { title, description } = buildVideoMetadata(
      {
        title: '2BHK Sea View',
        sublocality: 'Bandra West',
        city: 'Mumbai',
        location: 'ignored',
      },
      'Acme Realty'
    );
    expect(title).toBe('2BHK Sea View · Bandra West, Mumbai');
    expect(description).toContain('Location: Bandra West, Mumbai');
    expect(description).toContain('Listed by Acme Realty.');
  });

  it('falls back to location, then to a generic title', () => {
    expect(
      buildVideoMetadata({ title: 'Plot', location: 'Whitefield' }, 'X').title
    ).toBe('Plot · Whitefield');
    expect(buildVideoMetadata({}, 'X').title).toBe('Property listing');
  });

  it('strips angle brackets and caps the title at 100 chars', () => {
    const { title } = buildVideoMetadata(
      { title: `<b>${'a'.repeat(200)}</b>`, city: 'Pune' },
      'X'
    );
    expect(title).not.toMatch(/[<>]/);
    expect(title.length).toBeLessThanOrEqual(100);
  });
});

describe('isAuthError', () => {
  it('matches 401s and invalid_grant, but not quota errors', () => {
    expect(isAuthError(new YouTubeApiError('expired', 401))).toBe(true);
    expect(
      isAuthError(new YouTubeApiError('revoked', 400, 'invalid_grant'))
    ).toBe(true);
    expect(
      isAuthError(new YouTubeApiError('quota', 403, 'quotaExceeded'))
    ).toBe(false);
    expect(isAuthError(new Error('network'))).toBe(false);
  });
});

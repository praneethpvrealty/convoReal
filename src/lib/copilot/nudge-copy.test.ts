import { describe, expect, it } from 'vitest';
import { nudgeCopy, type NudgeId } from './nudge-copy';

const IDS: NudgeId[] = [
  'sessions-expiring',
  'hot-leads-quiet',
  'journeys-stalled',
  'radar-matches',
  'pulse-weekly-views',
  'setup-whatsapp',
  'setup-property',
  'setup-contact',
  'setup-email-leads',
  'setup-showcase-brand',
];

describe('nudge copy [CPL-007]', () => {
  it('words every nudge in English and Hindi with a call to action', () => {
    for (const id of IDS) {
      for (const language of ['en', 'hi'] as const) {
        const copy = nudgeCopy(id, 2, language);
        expect(copy.message, `${language}/${id}`).toBeTruthy();
        expect(copy.ctaLabel, `${language}/${id}`).toBeTruthy();
      }
      expect(nudgeCopy(id, 2, 'hi').message).not.toBe(
        nudgeCopy(id, 2, 'en').message
      );
    }
  });

  it('carries the count and pluralises', () => {
    expect(nudgeCopy('sessions-expiring', 1, 'en').message).toContain(
      '1 customer chat '
    );
    expect(nudgeCopy('sessions-expiring', 3, 'en').message).toContain(
      '3 customer chats'
    );
    expect(nudgeCopy('radar-matches', 4, 'hi').message).toContain('4');
    expect(nudgeCopy('pulse-weekly-views', 12, 'hi').message).toContain('12');
  });

  it('falls back to English for an untranslated language', () => {
    expect(nudgeCopy('setup-contact', 0, 'kn')).toEqual(
      nudgeCopy('setup-contact', 0, 'en')
    );
  });
});

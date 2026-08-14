import { describe, it, expect } from 'vitest';
import { LANGUAGE_CODES } from '@/lib/languages';
import { NARRATION_LANGUAGES } from '@/lib/video/listing-video';
import { narrationLanguageFor, reminderSpokenText } from './reminder-audio';

describe('reminderSpokenText', () => {
  const base = {
    clientName: 'Gopi',
    brandName: 'Aryavarta Ventures',
    title: 'Lakefront Villa',
    formattedTime: '15/08/2026, 10:30 am',
    locationText: 'Koramangala 4th Block',
    agenda: null,
    isSiteVisit: true,
  };

  it('speaks a site visit without agenda', () => {
    const text = reminderSpokenText(base);
    expect(text).toContain('Hi Gopi');
    expect(text).toContain('from Aryavarta Ventures');
    expect(text).toContain('property visit for Lakefront Villa');
    expect(text).toContain('on 15/08/2026, 10:30 am');
    expect(text).toContain('Location: Koramangala 4th Block.');
    expect(text).not.toContain('Agenda');
  });

  it('speaks a meeting with agenda', () => {
    const text = reminderSpokenText({
      ...base,
      isSiteVisit: false,
      agenda: 'Carry the khata copy',
    });
    expect(text).toContain('scheduled meeting: Lakefront Villa');
    expect(text).toContain('Agenda for the meeting: Carry the khata copy.');
    expect(text).not.toContain('property visit');
  });

  it('names the visit in a site-visit agenda', () => {
    const text = reminderSpokenText({ ...base, agenda: 'Bring ID proof' });
    expect(text).toContain('Agenda for the visit: Bring ID proof.');
  });

  it('invites a reply instead of the template button prompt', () => {
    const text = reminderSpokenText(base);
    expect(text).toContain('Reply here if you need any changes.');
    expect(text).not.toContain('tap a button');
  });
});

describe('narrationLanguageFor', () => {
  it('maps every conversation language to a Sarvam voice', () => {
    for (const code of LANGUAGE_CODES) {
      const narration = narrationLanguageFor(code);
      expect(narration in NARRATION_LANGUAGES).toBe(true);
      expect(narration.startsWith(code === 'en' ? 'en' : code)).toBe(true);
    }
  });
});

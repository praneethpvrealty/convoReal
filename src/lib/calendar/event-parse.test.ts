import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeEventType,
  istLocalToUtcIso,
  coerceEventDraft,
  resolveByName,
  parseEventFromInput,
} from './event-parse';

describe('normalizeEventType', () => {
  it('passes through canonical values', () => {
    expect(normalizeEventType('site_visit')).toBe('site_visit');
    expect(normalizeEventType('follow_up')).toBe('follow_up');
  });

  it('normalizes spacing, case and dashes', () => {
    expect(normalizeEventType('Site Visit')).toBe('site_visit');
    expect(normalizeEventType('follow-up')).toBe('follow_up');
  });

  it('maps synonyms to the closest type', () => {
    expect(normalizeEventType('property showing')).toBe('site_visit');
    expect(normalizeEventType('phone call')).toBe('call');
    expect(normalizeEventType('send agreement docs')).toBe('document');
    expect(normalizeEventType('client discussion')).toBe('meeting');
  });

  it('falls back to other', () => {
    expect(normalizeEventType(null)).toBe('other');
    expect(normalizeEventType('gibberish')).toBe('other');
  });
});

describe('istLocalToUtcIso', () => {
  it('converts IST wall-clock to UTC', () => {
    expect(istLocalToUtcIso('2026-07-15T10:00')).toBe('2026-07-15T04:30:00.000Z');
  });

  it('handles midnight rollover across dates', () => {
    expect(istLocalToUtcIso('2026-07-15T04:00')).toBe('2026-07-14T22:30:00.000Z');
  });

  it('returns null for missing or malformed input', () => {
    expect(istLocalToUtcIso(null)).toBeNull();
    expect(istLocalToUtcIso('tomorrow at 5')).toBeNull();
  });
});

describe('coerceEventDraft', () => {
  it('normalizes a full model response', () => {
    const draft = coerceEventDraft({
      intent: 'schedule',
      title: 'Site visit with Varun',
      event_type: 'Site Visit',
      start_time: '2026-07-15T16:00',
      duration_minutes: 45.6,
      contact_name: ' Varun ',
      priority: 'HIGH',
    });
    expect(draft.intent).toBe('schedule');
    expect(draft.event_type).toBe('site_visit');
    expect(draft.duration_minutes).toBe(46);
    expect(draft.contact_name).toBe('Varun');
    expect(draft.priority).toBe('high');
  });

  it('defaults unknown intent to none and bad priority to medium', () => {
    const draft = coerceEventDraft({ intent: 'listing', priority: 'urgent' });
    expect(draft.intent).toBe('none');
    expect(draft.priority).toBe('medium');
    expect(draft.title).toBe('Untitled');
  });

  it('survives non-object input', () => {
    expect(coerceEventDraft(null).intent).toBe('none');
    expect(coerceEventDraft('junk').intent).toBe('none');
  });
});

describe('resolveByName', () => {
  const contacts = [
    { id: '1', name: 'Surya Bajaj' },
    { id: '2', name: 'Varun' },
    { id: '3', name: 'Snigdha Rao' },
  ];

  it('finds exact and prefix matches', () => {
    expect(resolveByName('varun', contacts, (c) => c.name)?.id).toBe('2');
    expect(resolveByName('Surya', contacts, (c) => c.name)?.id).toBe('1');
  });

  it('matches when query has extra words', () => {
    expect(resolveByName('snigdha from koramangala'.split(' from ')[0], contacts, (c) => c.name)?.id).toBe('3');
  });

  it('prefers stronger matches over weak substring hits', () => {
    const rows = [
      { id: 'a', name: 'JP Nagar plot' },
      { id: 'b', name: 'JP Nagar 18k sqft commercial' },
    ];
    expect(resolveByName('jp nagar 18k sqft commercial', rows, (r) => r.name)?.id).toBe('b');
  });

  it('returns null instead of guessing', () => {
    expect(resolveByName('unknown person', contacts, (c) => c.name)).toBeNull();
    expect(resolveByName(null, contacts, (c) => c.name)).toBeNull();
  });
});

describe('parseEventFromInput image branch', () => {
  const captured: { parts: unknown[]; system: string }[] = [];

  const stubGemini = (reply: unknown) => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      captured.push({
        parts: body.contents?.[0]?.parts || [],
        system: body.systemInstruction?.parts?.[0]?.text || '',
      });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
        }),
      };
    });
  };

  beforeEach(() => {
    captured.length = 0;
    process.env.GEMINI_API_KEY ||= 'test-key';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the image as inlineData alongside a screenshot instruction', async () => {
    stubGemini({ intent: 'schedule', title: 'Meeting with Kusuma', event_type: 'meeting' });
    await parseEventFromInput({
      image: { base64: 'AAAA', mimeType: 'image/jpeg; charset=binary' },
    });

    const parts = captured[0].parts as { text?: string; inlineData?: { mimeType: string; data: string } }[];
    expect(parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'AAAA' });
    expect(parts[1].text).toContain('screenshot');
  });

  it('warns the model off bubble timestamps and unresolved threads', async () => {
    stubGemini({ intent: 'none' });
    await parseEventFromInput({ image: { base64: 'AAAA', mimeType: 'image/jpeg' } });

    const instruction = (captured[0].parts as { text?: string }[])[1].text || '';
    expect(instruction).toContain('when the MESSAGE was sent');
    expect(instruction).toContain('intent "none"');
  });

  it('parses a confirmed meeting thread into a schedule draft', async () => {
    stubGemini({
      intent: 'schedule',
      title: 'Meeting with Kusuma lawyer',
      event_type: 'meeting',
      start_time: '2026-08-03T17:00',
      contact_name: 'Kusuma',
      transcript: 'Monday 5 pm the meeting with Kusuma lawyer is confirmed right. / Yes Sharan, its confirmed',
    });
    const draft = await parseEventFromInput({
      image: { base64: 'AAAA', mimeType: 'image/jpeg' },
    });

    expect(draft.intent).toBe('schedule');
    expect(draft.event_type).toBe('meeting');
    expect(draft.contact_name).toBe('Kusuma');
    expect(istLocalToUtcIso(draft.start_time)).toBe('2026-08-03T11:30:00.000Z');
  });

  it('still rejects an input with no text, audio or image', async () => {
    await expect(parseEventFromInput({})).rejects.toThrow(/requires text, audio or an image/);
  });
});

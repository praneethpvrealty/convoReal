import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeEventType,
  istLocalToUtcIso,
  coerceEventDraft,
  coerceEventDrafts,
  resolveByName,
  parseEventFromInput,
  parseEventsFromInput,
  normalizeWeekday,
  alignDraftToNamedWeekday,
  type ParsedEventDraft,
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

  it('ignores a name buried inside a longer one', () => {
    // "Kusumaraju" ends in "raju", which contains "Raj" — filing an
    // advocate's meeting under an unrelated contact, and blocking the
    // liaisons lookup that only runs when no contact matched.
    const rows = [{ id: 'raj', name: 'Raj' }];
    expect(resolveByName('Kusumaraju', rows, (r) => r.name)).toBeNull();
    expect(resolveByName('Balaraj', rows, (r) => r.name)).toBeNull();
  });

  it('still matches a name that starts a word', () => {
    const rows = [
      { id: 'a', name: 'Raj Kumar' },
      { id: 'b', name: 'Priya Nair' },
    ];
    expect(resolveByName('Kumar', rows, (r) => r.name)?.id).toBe('a');
    expect(resolveByName('Nair', rows, (r) => r.name)?.id).toBe('b');
  });

  it('ignores fragments too short to identify anyone', () => {
    const rows = [{ id: 'a', name: 'Ramesh Gowda' }];
    expect(resolveByName('me', rows, (r) => r.name)).toBeNull();
  });

  it('keeps multi-word property matching on word boundaries', () => {
    const rows = [
      { id: 'a', name: 'CR-104 JP Nagar villa' },
      { id: 'b', name: 'Whitefield 18k sqft commercial' },
    ];
    expect(resolveByName('18k sqft commercial', rows, (r) => r.name)?.id).toBe('b');
    expect(resolveByName('104', rows, (r) => r.name)?.id).toBe('a');
  });
});

describe('coerceEventDrafts', () => {
  const request = (over: Record<string, unknown> = {}) => ({
    intent: 'task',
    title: 'Follow up with the advocate',
    ...over,
  });

  it('reads the requests array and keeps its order', () => {
    const drafts = coerceEventDrafts({
      requests: [
        request({ intent: 'notify', title: 'Kusumaraju meeting outcome' }),
        request({ title: 'Follow up next week' }),
      ],
    });

    expect(drafts.map((d) => d.intent)).toEqual(['notify', 'task']);
    expect(drafts[0].title).toBe('Kusumaraju meeting outcome');
    expect(drafts[1].title).toBe('Follow up next week');
  });

  it('accepts a lone object and a bare array', () => {
    expect(coerceEventDrafts(request()).map((d) => d.title)).toEqual(['Follow up with the advocate']);
    expect(coerceEventDrafts([request(), request()])).toHaveLength(2);
  });

  it('copies the envelope transcript onto every request', () => {
    const drafts = coerceEventDrafts({
      transcript: 'Send Sharan the update, and follow up after a week.',
      requests: [request({ intent: 'notify' }), request()],
    });

    expect(drafts[0].transcript).toBe('Send Sharan the update, and follow up after a week.');
    expect(drafts[1].transcript).toBe('Send Sharan the update, and follow up after a week.');
  });

  it("does not overwrite a request's own transcript", () => {
    const drafts = coerceEventDrafts({
      transcript: 'envelope',
      requests: [request({ transcript: 'its own' })],
    });

    expect(drafts[0].transcript).toBe('its own');
  });

  it('drops none entries so an empty result means nothing to do', () => {
    expect(coerceEventDrafts({ requests: [request({ intent: 'none' })] })).toEqual([]);
    expect(coerceEventDrafts({ requests: [] })).toEqual([]);
    expect(coerceEventDrafts({})).toEqual([]);
    expect(coerceEventDrafts({ requests: [request({ intent: 'none' }), request()] })).toHaveLength(1);
  });

  it('keeps notify as its own intent and carries the recipient', () => {
    const [draft] = coerceEventDrafts({
      requests: [request({ intent: 'notify', recipient_name: 'Sharan' })],
    });

    expect(draft.intent).toBe('notify');
    expect(draft.recipient_name).toBe('Sharan');
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

  it('returns every request a voice note carried', async () => {
    stubGemini({
      transcript:
        "Send Sharan the update on the Kusumaraju meeting. The advocate isn't available for a week, so follow up after that.",
      requests: [
        {
          intent: 'notify',
          title: 'Kusumaraju meeting outcome',
          recipient_name: 'Sharan',
          notes: 'Advocate unavailable for a week.',
        },
        {
          intent: 'task',
          title: "Follow up with Kusumaraju's advocate",
          start_time: '2026-08-20T10:00',
        },
      ],
    });
    const drafts = await parseEventsFromInput({
      audio: { base64: 'AAAA', mimeType: 'audio/ogg' },
      now: new Date('2026-08-13T04:00:00Z'),
    });

    expect(drafts).toHaveLength(2);
    expect(drafts[0].intent).toBe('notify');
    expect(drafts[0].recipient_name).toBe('Sharan');
    expect(drafts[1].intent).toBe('task');
    expect(istLocalToUtcIso(drafts[1].start_time)).toBe('2026-08-20T04:30:00.000Z');
    expect(drafts[0].transcript).toContain('Send Sharan the update');
  });

  it('keeps the single-draft callers on the first request', async () => {
    stubGemini({
      requests: [
        { intent: 'notify', title: 'Tell Sharan', recipient_name: 'Sharan' },
        { intent: 'task', title: 'Follow up' },
      ],
    });
    const draft = await parseEventFromInput({ text: 'let sharan know, then follow up' });

    expect(draft.intent).toBe('notify');
    expect(draft.title).toBe('Tell Sharan');
  });

  it('hands back a none draft that still carries the transcript', async () => {
    stubGemini({ transcript: 'Three BHK in Whitefield, 1.2 crore', requests: [] });
    const draft = await parseEventFromInput({
      audio: { base64: 'AAAA', mimeType: 'audio/ogg' },
    });

    expect(draft.intent).toBe('none');
    expect(draft.transcript).toBe('Three BHK in Whitefield, 1.2 crore');
  });

  it('asks the model for every request, not just one', async () => {
    stubGemini({ requests: [] });
    await parseEventsFromInput({ text: 'anything' });

    expect(captured[0].system).toContain('EVERY separate thing');
    expect(captured[0].system).toContain('"requests"');
  });

  it('corrects the model’s weekday arithmetic before returning', async () => {
    // Exactly what shipped: model answers Tue 4 Aug for a "Monday" thread.
    stubGemini({
      intent: 'schedule',
      title: 'Meeting with Kusuma lawyer',
      event_type: 'meeting',
      start_time: '2026-08-04T17:00',
      day_of_week: 'monday',
    });
    const draft = await parseEventFromInput({
      image: { base64: 'AAAA', mimeType: 'image/jpeg' },
      now: new Date('2026-08-01T08:19:00Z'),
    });

    expect(draft.start_time).toBe('2026-08-03T17:00');
  });

  it('applies the same correction to the typed-text path', async () => {
    stubGemini({
      intent: 'schedule',
      title: 'Meet the builder',
      event_type: 'meeting',
      start_time: '2026-08-04T11:00',
      day_of_week: 'monday',
    });
    const draft = await parseEventFromInput({
      text: 'meet the builder monday 11am',
      now: new Date('2026-08-01T08:19:00Z'),
    });

    expect(draft.start_time).toBe('2026-08-03T11:00');
  });

  it('asks the model to copy the weekday word rather than derive one', async () => {
    stubGemini({ intent: 'none' });
    await parseEventFromInput({ text: 'hello' });

    expect(captured[0].system).toContain('"day_of_week"');
    expect(captured[0].system).toContain('never a weekday you worked out');
  });
});

describe('normalizeWeekday', () => {
  it('accepts full names and the usual abbreviations', () => {
    expect(normalizeWeekday('Monday')).toBe(1);
    expect(normalizeWeekday('mon')).toBe(1);
    expect(normalizeWeekday('tues')).toBe(2);
    expect(normalizeWeekday('thurs')).toBe(4);
    expect(normalizeWeekday(' SATURDAY ')).toBe(6);
    expect(normalizeWeekday('sunday')).toBe(0);
  });

  it('rejects anything that is not a weekday', () => {
    expect(normalizeWeekday(null)).toBeNull();
    expect(normalizeWeekday('')).toBeNull();
    expect(normalizeWeekday('tomorrow')).toBeNull();
    expect(normalizeWeekday('m')).toBeNull();
  });
});

describe('alignDraftToNamedWeekday', () => {
  const SATURDAY_1_AUG = new Date('2026-08-01T08:19:00Z');

  const draft = (over: Partial<ParsedEventDraft>): ParsedEventDraft =>
    coerceEventDraft({ intent: 'schedule', title: 'Meeting', ...over });

  it('fixes the shipped bug: Monday must not become Tuesday', () => {
    // The model returned Tue 4 Aug for a thread that said "Monday 5 pm",
    // with Sat 1 Aug as today. Monday was the 3rd.
    const fixed = alignDraftToNamedWeekday(
      draft({ start_time: '2026-08-04T17:00', day_of_week: 'monday' }),
      SATURDAY_1_AUG
    );
    expect(fixed.start_time).toBe('2026-08-03T17:00');
    expect(istLocalToUtcIso(fixed.start_time)).toBe('2026-08-03T11:30:00.000Z');
  });

  it('leaves a date the model already got right untouched', () => {
    const d = draft({ start_time: '2026-08-03T17:00', day_of_week: 'monday' });
    expect(alignDraftToNamedWeekday(d, SATURDAY_1_AUG)).toBe(d);
  });

  it('keeps the week the model chose rather than pulling to the next weekday', () => {
    // "Monday after next" — model landed on Tue 11 Aug, so the intended
    // Monday is the 10th, not the 3rd.
    const fixed = alignDraftToNamedWeekday(
      draft({ start_time: '2026-08-11T17:00', day_of_week: 'monday' }),
      SATURDAY_1_AUG
    );
    expect(fixed.start_time).toBe('2026-08-10T17:00');
  });

  it('moves a snap that lands in the past forward a week', () => {
    // Model said Sat 1 Aug, source said Friday; Fri 31 Jul is behind us.
    const fixed = alignDraftToNamedWeekday(
      draft({ start_time: '2026-08-01T17:00', day_of_week: 'friday' }),
      SATURDAY_1_AUG
    );
    expect(fixed.start_time).toBe('2026-08-07T17:00');
  });

  it('carries end_time along by the same shift', () => {
    const fixed = alignDraftToNamedWeekday(
      draft({
        start_time: '2026-08-04T17:00',
        end_time: '2026-08-04T18:00',
        day_of_week: 'monday',
      }),
      SATURDAY_1_AUG
    );
    expect(fixed.start_time).toBe('2026-08-03T17:00');
    expect(fixed.end_time).toBe('2026-08-03T18:00');
  });

  it('does nothing when no weekday was named', () => {
    // "30th July" and "tomorrow" must not be second-guessed.
    const d = draft({ start_time: '2026-07-30T10:00', day_of_week: null });
    expect(alignDraftToNamedWeekday(d, SATURDAY_1_AUG)).toBe(d);
  });

  it('does nothing without a start time, or with an unparseable one', () => {
    const noStart = draft({ start_time: null, day_of_week: 'monday' });
    expect(alignDraftToNamedWeekday(noStart, SATURDAY_1_AUG)).toBe(noStart);
    const junk = draft({ start_time: 'next monday', day_of_week: 'monday' });
    expect(alignDraftToNamedWeekday(junk, SATURDAY_1_AUG)).toBe(junk);
  });

  it('lands on the named weekday from every possible model error', () => {
    for (let off = 0; off < 7; off++) {
      const day = String(2 + off).padStart(2, '0');
      const fixed = alignDraftToNamedWeekday(
        draft({ start_time: `2026-08-${day}T17:00`, day_of_week: 'wednesday' }),
        SATURDAY_1_AUG
      );
      const iso = istLocalToUtcIso(fixed.start_time)!;
      expect(new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }))
        .toBe('Wednesday');
      expect(new Date(iso).getTime()).toBeGreaterThan(SATURDAY_1_AUG.getTime());
    }
  });
});

describe('counterparty capture', () => {
  it('carries both names through coercion', () => {
    const draft = coerceEventDraft({
      intent: 'schedule',
      title: 'Meeting with Kusuma lawyer',
      contact_name: 'Kusuma',
      counterparty_name: 'Sharan',
    });
    expect(draft.contact_name).toBe('Kusuma');
    expect(draft.counterparty_name).toBe('Sharan');
  });

  it('defaults counterparty to null when the source has only one person', () => {
    expect(coerceEventDraft({ contact_name: 'Varun' }).counterparty_name).toBeNull();
  });

  it('resolves the counterparty independently of the person being met', () => {
    // Kusuma the lawyer is not an Engine contact; Sharan is. Before this, the
    // event linked nobody and so reminded nobody.
    const contacts = [
      { id: 'sharan-id', name: 'Sharan' },
      { id: 'other-id', name: 'Varun' },
    ];
    expect(resolveByName('Kusuma', contacts, (c) => c.name)).toBeNull();
    expect(resolveByName('Sharan', contacts, (c) => c.name)?.id).toBe('sharan-id');
  });
});

describe('service provider capture', () => {
  it('carries the professional role through coercion', () => {
    const draft = coerceEventDraft({
      intent: 'schedule',
      title: 'Meeting with Kusuma lawyer',
      contact_name: 'Kusuma',
      service_provider_role: 'lawyer',
    });
    expect(draft.service_provider_role).toBe('lawyer');
  });

  it('leaves the role null for an ordinary client meeting', () => {
    expect(coerceEventDraft({ contact_name: 'Varun' }).service_provider_role).toBeNull();
  });

  it('resolves a service provider against the liaisons directory', () => {
    // The same name that finds nothing in contacts finds the liaison.
    const contacts = [{ id: 'sharan-id', name: 'Sharan' }];
    const liaisons = [
      { id: 'kusuma-id', name: 'KusumamuniRaju' },
      { id: 'other-id', name: 'Prabhakar' },
    ];
    expect(resolveByName('KusumamuniRaju', contacts, (c) => c.name)).toBeNull();
    expect(resolveByName('KusumamuniRaju', liaisons, (l) => l.name)?.id).toBe('kusuma-id');
  });
});

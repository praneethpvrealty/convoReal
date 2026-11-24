import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedEventDraft } from './event-parse';
import {
  formatInboundConfirmation,
  isAvailabilityConditionedRequest,
  tryHandleInboundScheduling,
} from './whatsapp-scheduler';

const parseEventFromInput = vi.fn();
const parseEventUpdate = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const createNotification = vi.fn();
const recordBotTarget = vi.fn();
const clearBotTarget = vi.fn();
const latestBotTargetForPrompt = vi.fn();
const inserts: { table: string; row: Record<string, unknown> }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];
let appointmentRow: Record<string, unknown> | null = null;

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual =
    await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return {
    ...actual,
    parseEventFromInput: (...a: unknown[]) => parseEventFromInput(...a),
    parseEventUpdate: (...a: unknown[]) => parseEventUpdate(...a),
  };
});
vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...a: unknown[]) => burnCredits(...a),
}));
vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: (...a: unknown[]) => recordBotTarget(...a),
  clearBotTarget: (...a: unknown[]) => clearBotTarget(...a),
  latestBotTargetForPrompt: (...a: unknown[]) => latestBotTargetForPrompt(...a),
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));
vi.mock('@/lib/journey/visit-capture', () => ({
  recordSiteVisitBooked: vi.fn(),
  recordVisitRequestOnJourney: vi.fn(),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            table === 'appointments'
              ? appointmentRow
              : table === 'messages'
                ? { content_text: PROMPT_TEXT }
                : null,
          error: null,
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return {
            select: () => ({
              single: async () => ({ data: { id: 'appt-new' }, error: null }),
            }),
            then: (resolve: (v: { error: null }) => unknown) =>
              resolve({ error: null }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          return builder;
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return builder;
    },
  }),
}));

const RECORDED_REQUEST =
  'Hi Praneeth,\nI am looking properties in prestige meridian park. 3.5bhk in tower 5 only. If u have any unit in that tower then message me if we can have a visit tomorrow morning';
const RECORDED_CORRECTION = 'Not 10 am exactly but between 10-11 am';
const PROMPT_TEXT =
  '🗓 *Visit time needed*\n\nWhat time would suit you for the visit?\n\n_Request noted: can we have a site visit at Meridian Park tomorrow morning_';

function draft(overrides: Partial<ParsedEventDraft>): ParsedEventDraft {
  return {
    intent: 'schedule',
    title: 'Site visit at Prestige Meridian Park',
    event_type: 'site_visit',
    start_time: '2099-11-25T10:00',
    end_time: null,
    duration_minutes: 60,
    contact_name: null,
    property_hint: null,
    assignee_name: null,
    location: 'Prestige Meridian Park',
    priority: 'medium',
    notes: null,
    transcript: null,
    ...overrides,
  } as ParsedEventDraft;
}

function send(text: string) {
  return tryHandleInboundScheduling({
    message: { type: 'text' },
    contentText: text,
    contactRecord: { id: 'contact-1', phone: '919999999999', name: 'Gaurav' },
    conversation: { id: 'conv-1' },
    accountId: 'acct-1',
    ownerUserId: 'owner-1',
    assignedAgentUserId: 'agent-1',
    accessToken: 'token',
    phoneNumberId: 'phone-1',
  });
}

function sentTexts(): string[] {
  return sendTextMessage.mock.calls.map((c) => (c[0] as { text: string }).text);
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  appointmentRow = null;
  burnCredits.mockResolvedValue({ success: true });
  sendTextMessage.mockResolvedValue({ messageId: 'wamid.reply' });
  latestBotTargetForPrompt.mockResolvedValue(null);
  parseEventFromInput.mockResolvedValue(draft({}));
});

describe('[CAL-022] a lead booking is made only on what the lead actually said', () => {
  it('reads a search brief or an "if you have one" condition as not yet a booking', () => {
    expect(isAvailabilityConditionedRequest(RECORDED_REQUEST)).toBe(true);
    expect(
      isAvailabilityConditionedRequest(
        'If available can we visit tomorrow at 4pm'
      )
    ).toBe(true);
    expect(
      isAvailabilityConditionedRequest('Let me know if we can visit Sunday')
    ).toBe(true);
    expect(
      isAvailabilityConditionedRequest('Site visit tomorrow at 4pm please')
    ).toBe(false);
    expect(
      isAvailabilityConditionedRequest(
        'Looking forward to the visit tomorrow at 4pm'
      )
    ).toBe(false);
    expect(
      isAvailabilityConditionedRequest(
        "I'm looking for a site visit on Saturday at 3pm"
      )
    ).toBe(false);
    expect(
      isAvailabilityConditionedRequest('Looking for 3pm tomorrow for the visit')
    ).toBe(false);
    expect(
      isAvailabilityConditionedRequest('Looking for 3 bhk, visit tomorrow 3pm')
    ).toBe(true);
  });

  it('takes noon as a stated time', async () => {
    expect(await send('Site visit tomorrow at noon please')).toBe(true);
    expect(parseEventFromInput).toHaveBeenCalled();
    expect(sentTexts()[0]).toContain("I've noted your request");
  });

  it('does not ask for a time when no day was named either', async () => {
    expect(await send('Remind me about the visit')).toBe(false);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(recordBotTarget).not.toHaveBeenCalled();
  });

  it('books nothing and spends nothing on the recorded conditional request', async () => {
    expect(await send(RECORDED_REQUEST)).toBe(false);
    expect(parseEventFromInput).not.toHaveBeenCalled();
    expect(burnCredits).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(inserts.filter((i) => i.table === 'appointments')).toEqual([]);
  });

  it('asks for the time instead of guessing one for "tomorrow morning"', async () => {
    expect(
      await send('We can have a site visit at Meridian Park tomorrow morning')
    ).toBe(true);
    expect(parseEventFromInput).not.toHaveBeenCalled();
    expect(inserts.filter((i) => i.table === 'appointments')).toEqual([]);
    expect(sentTexts()[0]).toContain('What time would suit you');
    expect(recordBotTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'contact',
        entityId: 'contact-1',
        waMessageId: 'wamid.reply',
      })
    );
  });

  it('leaves a meeting with no time to the agent rather than inventing one', async () => {
    expect(await send('Let us meet tomorrow')).toBe(false);
    expect(parseEventFromInput).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('books once the lead answers the time question', async () => {
    latestBotTargetForPrompt.mockImplementation(
      async (p: { entityType: string }) =>
        p.entityType === 'contact'
          ? {
              entityType: 'contact',
              entityId: 'contact-1',
              waMessageId: 'wamid.prompt',
            }
          : null
    );
    expect(await send('between 10-11 am')).toBe(true);
    expect(
      (parseEventFromInput.mock.calls[0][0] as { text: string }).text
    ).toContain('tomorrow morning');
    const booked = inserts.find((i) => i.table === 'appointments');
    expect(booked?.row.event_type).toBe('site_visit');
    expect(clearBotTarget).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wamid.prompt' })
    );
    expect(recordBotTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'appointment',
        entityId: 'appt-new',
      })
    );
  });

  it("ignores a time question addressed to another lead's thread", async () => {
    latestBotTargetForPrompt.mockImplementation(
      async (p: { entityType: string }) =>
        p.entityType === 'contact'
          ? {
              entityType: 'contact',
              entityId: 'someone-else',
              waMessageId: 'wamid.prompt',
            }
          : null
    );
    expect(await send('10 am')).toBe(false);
    expect(inserts).toEqual([]);
  });

  it('registers the confirmation so a reply can change the booking', async () => {
    expect(await send('Site visit tomorrow at 4pm please')).toBe(true);
    expect(recordBotTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'appointment',
        entityId: 'appt-new',
        waMessageId: 'wamid.reply',
      })
    );
  });

  function standingConfirmation() {
    latestBotTargetForPrompt.mockImplementation(
      async (p: { entityType: string }) =>
        p.entityType === 'appointment'
          ? {
              entityType: 'appointment',
              entityId: 'appt-1',
              waMessageId: 'wamid.confirmation',
            }
          : null
    );
    appointmentRow = {
      id: 'appt-1',
      title: 'Site visit at Prestige Meridian Park - Tower 5',
      event_type: 'site_visit',
      start_time: '2099-11-25T04:30:00+00:00',
      end_time: '2099-11-25T05:30:00+00:00',
      location: 'Prestige Meridian Park',
      description: 'Client is looking for a 3.5bhk in Tower 5 only.',
      transcript: null,
      status: 'scheduled',
      assigned_to: 'agent-1',
    };
  }

  it('acknowledges the recorded "between 10-11 am" reply and tells the agent', async () => {
    standingConfirmation();
    parseEventUpdate.mockResolvedValue(
      draft({ start_time: '2099-11-25T10:00', end_time: '2099-11-25T11:00' })
    );
    expect(await send(RECORDED_CORRECTION)).toBe(true);
    const patch = updates.find((u) => u.table === 'appointments')?.patch;
    expect(patch?.description).toContain(`Lead: ${RECORDED_CORRECTION}`);
    expect(patch).not.toHaveProperty('reminder_1h_sent');
    expect(sentTexts()[0]).toContain("I've updated your request");
    expect(sentTexts()[0]).toContain(RECORDED_CORRECTION);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-1', entityId: 'appt-1' })
    );
    expect(inserts.filter((i) => i.table === 'appointments')).toEqual([]);
  });

  it('moves the visit and re-arms reminders when the lead names a new time', async () => {
    standingConfirmation();
    parseEventUpdate.mockResolvedValue(
      draft({ start_time: '2099-11-25T16:00', end_time: null })
    );
    expect(await send('Make it 4 pm')).toBe(true);
    const patch = updates.find((u) => u.table === 'appointments')?.patch;
    expect(patch?.start_time).toBe('2099-11-25T10:30:00.000Z');
    expect(patch?.end_time).toBe('2099-11-25T11:30:00.000Z');
    expect(patch?.reminder_1h_sent).toBe(false);
    expect(clearBotTarget).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wamid.confirmation' })
    );
  });

  it('keeps the visit length when the model carries the old end time through', async () => {
    standingConfirmation();
    parseEventUpdate.mockResolvedValue(
      draft({ start_time: '2099-11-24T09:00', end_time: '2099-11-25T11:00' })
    );
    expect(await send('Make it 9 am the day before')).toBe(true);
    const patch = updates.find((u) => u.table === 'appointments')?.patch;
    expect(patch?.start_time).toBe('2099-11-24T03:30:00.000Z');
    expect(patch?.end_time).toBe('2099-11-24T04:30:00.000Z');
  });

  it('does not treat a passing mention of the day as a change', async () => {
    standingConfirmation();
    expect(await send('Ok see you tomorrow')).toBe(false);
    expect(parseEventUpdate).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('never moves a visit into the past', async () => {
    standingConfirmation();
    parseEventUpdate.mockResolvedValue(
      draft({ start_time: '2020-01-01T10:00' })
    );
    expect(await send('Make it 10 am')).toBe(false);
    expect(updates).toEqual([]);
  });

  it('does not repeat the place the title already names', () => {
    const msg = formatInboundConfirmation({
      contactName: 'Gaurav Bhagwat',
      title: 'Site visit at Prestige Meridian Park - Tower 5',
      eventType: 'site_visit',
      startIso: '2026-11-25T04:30:00.000Z',
      propertyTitle: null,
      location: 'Prestige Meridian Park',
    });
    expect(msg).not.toContain('📌');
    expect(msg).toContain('10:00 am');
  });
});

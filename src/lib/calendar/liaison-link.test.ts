import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseEventFromInput = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const inserts: { table: string; row: Record<string, unknown> }[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual = await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return { ...actual, parseEventFromInput: (...a: unknown[]) => parseEventFromInput(...a) };
});

vi.mock('@/lib/credits/burn', () => ({ burnCredits: (...a: unknown[]) => burnCredits(...a) }));
vi.mock('@/lib/whatsapp/bot-message-target', () => ({ recordBotTarget: vi.fn(async () => {}) }));
vi.mock('@/lib/notifications/create', () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return builder;
        },
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        or: () => builder,
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        single: async () => ({ data: { id: 'new-appt' }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: tables[table] ?? [], error: null }),
      });
      return builder;
    },
  }),
}));

import { tryHandleOwnerScheduling } from './whatsapp-scheduler';

const baseParams = {
  message: { id: 'm1', type: 'text' },
  contactRecord: { id: 'c1', phone: '+919876543210' },
  conversation: { id: 'conv-1' },
  accountId: 'acc',
  userId: 'user-1',
  accessToken: 'tok',
  phoneNumberId: 'pnid',
};

const draft = (over: Record<string, unknown>) => ({
  intent: 'schedule',
  title: 'Meeting with KusumamuniRaju lawyer',
  event_type: 'meeting',
  start_time: '2026-08-03T17:00',
  end_time: null,
  duration_minutes: null,
  contact_name: 'KusumamuniRaju',
  counterparty_name: 'Sharan',
  service_provider_role: 'lawyer',
  property_hint: null,
  assignee_name: null,
  location: null,
  priority: 'medium',
  notes: null,
  transcript: null,
  day_of_week: null,
  ...over,
});

beforeEach(() => {
  inserts.length = 0;
  burnCredits.mockReset().mockResolvedValue({ success: true });
  sendTextMessage.mockReset().mockResolvedValue({ messageId: 'wamid.card' });
  parseEventFromInput.mockReset();
  tables = {
    contacts: [{ id: 'sharan-id', name: 'Sharan', phone: '+919000000001' }],
    properties: [],
    profiles: [],
    liaisons: [{ id: 'kusuma-id', name: 'KusumamuniRaju', phone: '+919000000002' }],
  };
});

const appt = () => inserts.find((i) => i.table === 'appointments')!.row;

describe('liaison linking on a scheduled event', () => {
  it('links the service provider from the liaisons directory', async () => {
    parseEventFromInput.mockResolvedValue(draft({}));
    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'schedule meeting with KusumamuniRaju lawyer monday 5pm' });

    expect(appt().liaison_id).toBe('kusuma-id');
  });

  it('keeps the liaison out of the client reminder path', async () => {
    // contact_ids drives client reminders — a liaison must not land there.
    parseEventFromInput.mockResolvedValue(draft({}));
    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'meeting monday 5pm' });

    expect(appt().contact_ids).toEqual(['sharan-id']);
    expect(appt().contact_ids).not.toContain('kusuma-id');
    expect(appt().contact_id).toBe('sharan-id');
  });

  it('flags a professional who is in neither directory', async () => {
    tables.liaisons = [];
    parseEventFromInput.mockResolvedValue(draft({}));
    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'meeting monday 5pm' });

    expect(appt().liaison_id).toBeNull();
    const card = sendTextMessage.mock.calls[0][0].text as string;
    expect(card).toContain('KusumamuniRaju');
    expect(card).toContain('Liaisons');
  });

  it('prefers a real contact over a liaison of the same name', async () => {
    tables.contacts = [{ id: 'contact-kusuma', name: 'KusumamuniRaju', phone: '+919000000003' }];
    parseEventFromInput.mockResolvedValue(draft({ counterparty_name: null }));
    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'meeting monday 5pm' });

    expect(appt().contact_ids).toEqual(['contact-kusuma']);
    expect(appt().liaison_id).toBeNull();
  });

  it('does not touch the directory for an ordinary client meeting', async () => {
    parseEventFromInput.mockResolvedValue(
      draft({ contact_name: 'Sharan', counterparty_name: null, service_provider_role: null })
    );
    await tryHandleOwnerScheduling({ ...baseParams, contentText: 'meeting with sharan monday 5pm' });

    expect(appt().liaison_id).toBeNull();
    const card = sendTextMessage.mock.calls[0][0].text as string;
    expect(card).not.toContain('Liaisons');
  });
});

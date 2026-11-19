import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  appointment: null as Row | null,
  contacts: [] as Row[],
  profiles: [] as Row[],
  updates: [] as Row[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let update: Row | null = null;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      const rows = () =>
        table === 'contacts'
          ? state.contacts
          : table === 'profiles'
            ? state.profiles
            : [];
      Object.assign(builder, {
        select: chain,
        eq: chain,
        is: chain,
        contains: chain,
        in: chain,
        update: (row: Row) => {
          update = row;
          state.updates.push(row);
          return builder;
        },
        maybeSingle: async () => {
          if (table === 'appointment_reminder_log') {
            return {
              data: {
                appointment_id: 'appt-1',
                rearmed_at: null,
                appointment: { reminders_rearmed_at: null },
              },
              error: null,
            };
          }
          if (table === 'appointments' && update) {
            return { data: state.appointment, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows(), error: null }),
      });
      return builder;
    },
  }),
}));

const send = vi.fn();
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) => send(...args),
}));

import { handleReminderButtonReply } from './reminder-reply';

function tap(text: string) {
  return {
    id: 'wamid.tap',
    from: '919800000001',
    timestamp: '0',
    type: 'button',
    button: { text, payload: text },
    context: { id: 'wamid.reminder' },
  } as unknown as Parameters<typeof handleReminderButtonReply>[0];
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ success: true });
  state.updates = [];
  state.appointment = {
    id: 'appt-1',
    title: 'Visit with Yusuf',
    start_time: '2026-11-19T06:30:00.000Z',
    event_type: 'site_visit',
    user_id: 'creator',
    assigned_to: 'agent',
    remind_creator: true,
    contact_id: 'buyer',
    contact_ids: ['buyer', 'owner'],
    remind_liaison: true,
    liaison: { name: 'Ramesh (lawyer)' },
    property: { title: 'Apartment Building for Sale in HBR Layout' },
  };
  state.contacts = [
    { id: 'buyer', name: 'Yusuf Sameer', phone: '+919800000001' },
    { id: 'owner', name: 'Lakshmi', phone: '+919800000002' },
  ];
  state.profiles = [
    { user_id: 'agent', phone: '+919811111111' },
    { user_id: 'creator', phone: '+919822222222' },
  ];
});

describe('handleReminderButtonReply', () => {
  it('[CAL-021] tells the client their time is on hold when they ask to reschedule', async () => {
    const consumed = await handleReminderButtonReply(
      tap('Requesting reschedule'),
      'acc',
      'buyer',
      'conv',
      'owner-user'
    );

    expect(consumed).toBe(true);
    expect(state.updates[0]).toMatchObject({ client_confirmed_at: null });
    expect(state.updates[0].reschedule_requested_at).toEqual(
      expect.any(String)
    );
    const ack = send.mock.calls[0][0];
    expect(ack).toMatchObject({ contactId: 'buyer', conversationId: 'conv' });
    expect(ack.text).toContain(
      'property visit for "Apartment Building for Sale in HBR Layout"'
    );
    expect(ack.text).toContain("you won't get more reminders for that time");
  });

  it('[CAL-021] tells every reminded member who asked and whose reminders are held', async () => {
    await handleReminderButtonReply(
      tap('Requesting reschedule'),
      'acc',
      'buyer',
      'conv',
      'owner-user'
    );

    const pings = send.mock.calls.slice(1).map(([arg]) => arg);
    expect(pings.map((p) => p.toPhone)).toEqual([
      '919811111111',
      '919822222222',
    ]);
    for (const ping of pings) {
      expect(ping.text).toContain(
        'Yusuf Sameer tapped "Requesting reschedule"'
      );
      expect(ping.text).toContain('including Lakshmi, Ramesh (lawyer)');
      expect(ping.text).toContain('notify all participants');
    }
  });

  it('[CAL-021] pings only the member who runs the event when the client confirms', async () => {
    await handleReminderButtonReply(
      tap('Fine'),
      'acc',
      'buyer',
      'conv',
      'owner-user'
    );

    expect(state.updates[0]).toMatchObject({ reschedule_requested_at: null });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].text).toContain('is confirmed');
    expect(send.mock.calls[1][0].toPhone).toBe('919811111111');
  });
});

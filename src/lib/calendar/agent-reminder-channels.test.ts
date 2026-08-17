import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const createNotification = vi.fn();
const updates: Record<string, unknown>[] = [];
let appointments: Record<string, unknown>[] = [];
let profiles: Record<string, unknown>[] = [];
let contacts: Record<string, unknown>[] = [];

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...a: unknown[]) => sendWhatsAppMessageAndPersist(...a),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: vi.fn(async () => undefined),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return builder;
        },
        eq: () => builder,
        gt: () => builder,
        lte: () => builder,
        in: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data:
              table === 'appointments'
                ? appointments
                : table === 'profiles'
                  ? profiles
                  : table === 'contacts'
                    ? contacts
                    : [],
            error: null,
          }),
      });
      return builder;
    },
  }),
}));

import { sendAgentEventReminders } from './agent-reminders';

const NOW = new Date('2026-08-03T10:30:00Z');

beforeEach(() => {
  updates.length = 0;
  sendWhatsAppMessageAndPersist.mockReset();
  createNotification.mockReset().mockResolvedValue(undefined);
  profiles = [{ user_id: 'agent-1', phone: '+919876543210', full_name: 'Pranav' }];
  contacts = [];
  appointments = [
    {
      id: 'appt-1',
      account_id: 'acc',
      user_id: 'agent-1',
      assigned_to: 'agent-1',
      title: 'Meeting with KusumamuniRaju lawyer',
      event_type: 'meeting',
      start_time: '2026-08-03T11:30:00Z',
      end_time: '2026-08-03T12:30:00Z',
      location: null,
      agenda: null,
      contact_ids: [],
      contact: null,
      property: null,
    },
  ];
});

describe('sendAgentEventReminders channel independence', () => {
  it('still notifies in-app when the 24h WhatsApp window is closed', async () => {
    // Meta rejects free-form text outside the service window — the common
    // case for an event booked days ahead.
    sendWhatsAppMessageAndPersist.mockResolvedValue({
      success: false,
      error: 'Message failed to send because more than 24 hours have passed',
    });

    await sendAgentEventReminders(NOW);

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0]).toMatchObject({
      userId: 'agent-1',
      type: 'appointment_reminder',
      entityId: 'appt-1',
    });
  });

  it('does not retry forever on a closed window', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: false, error: 'window closed' });
    await sendAgentEventReminders(NOW);
    expect(updates).toContainEqual({ agent_reminder_sent: true });
  });

  it('notifies exactly once when WhatsApp does go through', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true, whatsappMessageId: 'wamid.1' });
    await sendAgentEventReminders(NOW);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ agent_reminder_sent: true });
  });

  it('offers a tracked Utility message action for the linked contact', async () => {
    appointments[0] = {
      ...appointments[0],
      contact_ids: ['contact-1', 'contact-self'],
      contact: {
        id: 'contact-1',
        name: 'Nadeem',
        phone: '+919886140608',
      },
    };
    contacts = [
      {
        id: 'contact-self',
        name: 'Praneeth Kumar Sajepa',
        phone: '+919876543210',
      },
    ];
    sendWhatsAppMessageAndPersist.mockResolvedValue({
      success: true,
      whatsappMessageId: 'wamid.1',
    });

    await sendAgentEventReminders(NOW);

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'interactive',
        interactiveType: 'buttons',
        interactiveButtons: [
          {
            id: 'arm_msg:appt-1:contact-1',
            title: 'Message Nadeem',
          },
        ],
      })
    );
  });

  it('marks an assignee with no reachable phone without notifying', async () => {
    profiles = [];
    await sendAgentEventReminders(NOW);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(updates).toContainEqual({ agent_reminder_sent: true });
  });
});

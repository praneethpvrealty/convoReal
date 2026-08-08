import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The overdue nudge asks "how did it go?" — so the reply to it has to
 * land somewhere. It didn't: the card was the only reminder that never
 * recorded a bot target, so a quote-reply on it resolved to nothing and
 * "he visited the property yesterday" came back "I couldn't tell what
 * that was" while the visit stayed open.
 */

const sendWhatsAppMessageAndPersist = vi.fn();
const createNotification = vi.fn();
const recordBotTarget = vi.fn();
const updates: Record<string, unknown>[] = [];
let appointments: Record<string, unknown>[] = [];
let profiles: Record<string, unknown>[] = [];

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...a: unknown[]) => sendWhatsAppMessageAndPersist(...a),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: (...a: unknown[]) => recordBotTarget(...a),
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
        lt: () => builder,
        lte: () => builder,
        in: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data: table === 'appointments' ? appointments : table === 'profiles' ? profiles : [],
            error: null,
          }),
      });
      return builder;
    },
  }),
}));

import { sendOverdueNudges } from './agent-reminders';

const NOW = new Date('2026-08-08T13:00:00Z');

beforeEach(() => {
  updates.length = 0;
  sendWhatsAppMessageAndPersist.mockReset();
  createNotification.mockReset().mockResolvedValue(undefined);
  recordBotTarget.mockReset().mockResolvedValue(undefined);
  profiles = [{ user_id: 'agent-1', phone: '+919876543210', full_name: 'Pranav' }];
  appointments = [
    {
      id: 'appt-1',
      account_id: 'acc',
      user_id: 'agent-1',
      assigned_to: 'agent-1',
      title: 'Site visit',
      event_type: 'site_visit',
      start_time: '2026-08-08T04:30:00Z',
      end_time: '2026-08-08T05:30:00Z',
      location: null,
      contact: { id: 'c-1', name: 'Hari', phone: '+919000000000' },
      property: null,
    },
  ];
});

describe('sendOverdueNudges', () => {
  it('makes the card answerable by recording its target', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true, whatsappMessageId: 'wamid.nudge' });

    await sendOverdueNudges(NOW);

    expect(recordBotTarget).toHaveBeenCalledTimes(1);
    expect(recordBotTarget.mock.calls[0][0]).toMatchObject({
      accountId: 'acc',
      waMessageId: 'wamid.nudge',
      entityType: 'appointment',
      entityId: 'appt-1',
    });
  });

  it('records nothing when the send never reached WhatsApp', async () => {
    // No wamid means no card to quote — a target row keyed on nothing
    // would only ever match another account's reply.
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: false, error: 'window closed' });

    await sendOverdueNudges(NOW);

    expect(recordBotTarget).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('asks for a reply rather than sending the agent to the dashboard', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true, whatsappMessageId: 'wamid.nudge' });

    await sendOverdueNudges(NOW);

    const text = sendWhatsAppMessageAndPersist.mock.calls[0][0].text as string;
    expect(text).toMatch(/reply to this message/i);
    expect(text).not.toMatch(/Calendar page/i);
  });

  it('still marks the nudge sent so it cannot loop', async () => {
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: false, error: 'window closed' });
    await sendOverdueNudges(NOW);
    expect(updates).toContainEqual({ overdue_nudge_sent: true });
  });
});

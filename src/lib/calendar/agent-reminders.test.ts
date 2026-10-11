import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The morning digest bailed out before ever looking at todos when
 * nobody had an appointment that day — so an agent with only overdue
 * todos and no appointment never got a digest, and agent_digest_log
 * never recorded that day either.
 */

const sendWhatsAppMessageAndPersist = vi.fn();
const createNotification = vi.fn();
const inserts: Record<string, unknown>[] = [];
let appointments: Record<string, unknown>[] = [];
let todos: Record<string, unknown>[] = [];
let profiles: Record<string, unknown>[] = [];

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...a: unknown[]) =>
    sendWhatsAppMessageAndPersist(...a),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: vi.fn(),
}));

vi.mock('@/lib/notifications/quiet-hours', () => ({
  resolveQuietPeriod: async () => ({ isQuiet: false, deliverAt: null }),
}));

vi.mock('@/lib/notifications/preferences', () => ({
  resolveChannels: async () => ({ whatsapp: true, inApp: true }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lt: () => builder,
        in: () => builder,
        order: () => builder,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, ...row });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data:
              table === 'appointments'
                ? appointments
                : table === 'todos'
                  ? todos
                  : table === 'profiles'
                    ? profiles
                    : [],
            error: null,
          }),
      });
      return builder;
    },
  }),
}));

import { sendDailyScheduleDigests } from './agent-reminders';

const NOW = new Date('2026-10-11T04:00:00Z'); // 09:30 IST — inside the morning window

beforeEach(() => {
  inserts.length = 0;
  appointments = [];
  todos = [];
  profiles = [
    { user_id: 'agent-1', phone: '+919876543210', full_name: 'Pranav' },
  ];
  sendWhatsAppMessageAndPersist.mockReset().mockResolvedValue({
    success: true,
    whatsappMessageId: 'wamid.digest',
  });
  createNotification.mockReset().mockResolvedValue(undefined);
});

describe('sendDailyScheduleDigests', () => {
  it('sends the digest for a todos-only day with no appointments', async () => {
    todos = [
      {
        account_id: 'acc',
        user_id: 'agent-1',
        assigned_to: 'agent-1',
        title: 'Follow up with buyer',
        priority: 'high',
        due_date: '2026-10-11T05:00:00Z',
      },
    ];

    await sendDailyScheduleDigests(NOW);

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        table: 'agent_digest_log',
        account_id: 'acc',
        user_id: 'agent-1',
      })
    );
  });

  it('sends nothing when there are no appointments and no todos', async () => {
    await sendDailyScheduleDigests(NOW);

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});

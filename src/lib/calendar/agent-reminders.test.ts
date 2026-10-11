import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The morning digest bailed out before ever looking at todos when
 * nobody had an appointment that day — so an agent with only overdue
 * todos and no appointment never got a digest, and agent_digest_log
 * never recorded that day either. A `due_date >= today` lower bound
 * on the todos query made the same mistake one layer down: it still
 * excluded a todo overdue from an earlier day. The mock below applies
 * gte/lt/not filters for real, so either regression fails this file.
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

type Filter = (row: Record<string, unknown>) => boolean;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Filter[] = [];
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((row) => row[col] === val);
          return builder;
        },
        gte: (col: string, val: string) => {
          filters.push((row) => {
            const v = row[col];
            return v != null && v >= val;
          });
          return builder;
        },
        lt: (col: string, val: string) => {
          filters.push((row) => {
            const v = row[col];
            return v != null && v < val;
          });
          return builder;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null) {
            filters.push((row) => row[col] != null);
          }
          return builder;
        },
        in: () => builder,
        order: () => builder,
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, ...row });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
          const source =
            table === 'appointments'
              ? appointments
              : table === 'todos'
                ? todos
                : table === 'profiles'
                  ? profiles
                  : [];
          return resolve({
            data: source.filter((row) => filters.every((f) => f(row))),
            error: null,
          });
        },
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
  it('sends the digest for a todo overdue from an earlier day, with no appointments today', async () => {
    // The motivating case: still open, due before today's IST window —
    // a naive due_date >= today filter would miss it just like the
    // appointments-only gate used to.
    todos = [
      {
        account_id: 'acc',
        user_id: 'agent-1',
        assigned_to: 'agent-1',
        title: 'Follow up with buyer',
        priority: 'high',
        due_date: '2026-10-05T05:00:00Z',
        completed: false,
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

  it('sends the digest for a todo due today, with no appointments', async () => {
    todos = [
      {
        account_id: 'acc',
        user_id: 'agent-1',
        assigned_to: 'agent-1',
        title: 'Follow up with buyer',
        priority: 'high',
        due_date: '2026-10-11T05:00:00Z',
        completed: false,
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

  it('does not pull in a todo due on a future day', async () => {
    todos = [
      {
        account_id: 'acc',
        user_id: 'agent-1',
        assigned_to: 'agent-1',
        title: 'Not yet',
        priority: 'low',
        due_date: '2026-10-15T05:00:00Z',
        completed: false,
      },
    ];

    await sendDailyScheduleDigests(NOW);

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('sends nothing when there are no appointments and no todos', async () => {
    await sendDailyScheduleDigests(NOW);

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});

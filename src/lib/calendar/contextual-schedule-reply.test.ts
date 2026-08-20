import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  coerceCompletedItems,
  coerceUpdatedItems,
  type ParsedEventDraft,
} from './event-parse';
import { tryHandleOwnerScheduling } from './whatsapp-scheduler';

const sendTextMessage = vi.fn(async () => ({ messageId: 'wamid.sent-1' }));
const burnCredits = vi.fn(async () => ({ success: true }));
const recordBotTarget = vi.fn(async () => {});

let appointmentsTable: Record<string, unknown>[] = [];
let todosTable: Record<string, unknown>[] = [];
let messagesTable: Record<string, unknown>[] = [];

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: () => burnCredits(),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (params: { text: string }) => sendTextMessage(params),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: () => recordBotTarget(),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let updatePayload: Record<string, unknown> | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        gte: (col: string, val: unknown) => {
          filters[`gte_${col}`] = val;
          return builder;
        },
        lt: (col: string, val: unknown) => {
          filters[`lt_${col}`] = val;
          return builder;
        },
        limit: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === 'messages') {
            const hit = messagesTable.find(
              (m) =>
                (!filters.message_id || m.message_id === filters.message_id) &&
                (!filters.conversation_id || m.conversation_id === filters.conversation_id)
            );
            return { data: hit || null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          return { data: { id: `${table}-new-id` }, error: null };
        },
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const r of arr) {
            const inserted = { id: `${table}-${Date.now()}-${Math.random()}`, ...r };
            if (table === 'appointments') appointmentsTable.push(inserted);
            if (table === 'todos') todosTable.push(inserted);
          }
          return {
            select: () => ({
              single: async () => ({ data: { id: `${table}-inserted-id` }, error: null }),
            }),
            then: (resolve: (v: { data: { id: string }; error: null }) => unknown) =>
              resolve({ data: { id: `${table}-inserted-id` }, error: null }),
          };
        },
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload;
          return {
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              if (table === 'appointments') {
                const item = appointmentsTable.find((a) => a[col] === val);
                if (item) Object.assign(item, updatePayload);
              }
              if (table === 'todos') {
                const item = todosTable.find((t) => t[col] === val);
                if (item) Object.assign(item, updatePayload);
              }
              return {
                eq: () => ({ error: null }),
                error: null,
              };
            },
          };
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
          if (table === 'profiles') {
            return resolve({
              data: [{ user_id: 'user-1', full_name: 'Praneeth' }],
              error: null,
            });
          }
          if (table === 'contacts') {
            return resolve({
              data: [
                { id: 'contact-naveen', name: 'Naveen Bandary', phone: '+919876543210' },
                { id: 'contact-advocate', name: 'Kusumaraju Advocate', phone: '+919876543211' },
              ],
              error: null,
            });
          }
          if (table === 'properties') {
            return resolve({
              data: [{ id: 'prop-1', title: 'Vishweshwar layout plot', location: 'Vishweshwar layout' }],
              error: null,
            });
          }
          if (table === 'appointments') {
            return resolve({ data: appointmentsTable, error: null });
          }
          if (table === 'todos') {
            return resolve({ data: todosTable, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

describe('Contextual schedule reply handling', () => {
  beforeEach(() => {
    appointmentsTable = [];
    todosTable = [];
    messagesTable = [];
    sendTextMessage.mockClear();
    burnCredits.mockClear();
    recordBotTarget.mockClear();
  });

  describe('event-parse coercion helpers', () => {
    it('coerces completed items from Gemini response envelope', () => {
      const raw = {
        completed_items: [
          {
            id: 'appt-123',
            type: 'appointment',
            status: 'completed',
            outcome: 'Called, now scheduled to meet him tomorrow morning',
          },
          {
            id: 'todo-456',
            type: 'todo',
            status: 'completed',
            outcome: 'Advocate follow up done',
          },
        ],
      };
      const items = coerceCompletedItems(raw);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        id: 'appt-123',
        type: 'appointment',
        status: 'completed',
        outcome: 'Called, now scheduled to meet him tomorrow morning',
        title: undefined,
      });
      expect(items[1]).toEqual({
        id: 'todo-456',
        type: 'todo',
        status: 'completed',
        outcome: 'Advocate follow up done',
        title: undefined,
      });
    });

    it('coerces updated items with weekday alignment', () => {
      const raw = {
        updated_items: [
          {
            id: 'appt-123',
            type: 'appointment',
            start_time: '2026-08-20T16:00',
            day_of_week: 'thursday',
          },
        ],
      };
      const items = coerceUpdatedItems(raw, new Date('2026-08-20T10:00:00+05:30'));
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('appt-123');
      expect(items[0].start_time).toBe('2026-08-20T16:00');
    });
  });

  describe('tryHandleOwnerScheduling contextual digest reply flow', () => {
    it('marks call completed and adds follow-up meeting when replying to morning schedule digest', async () => {
      // 1. Setup existing appointment for today
      appointmentsTable = [
        {
          id: 'appt-call-naveen',
          account_id: 'acc-1',
          user_id: 'user-1',
          assigned_to: 'user-1',
          title: 'Call Naveen Bandary · Naveen Kumar',
          event_type: 'call',
          start_time: '2026-08-20T04:30:00.000Z',
          status: 'scheduled',
          contact_id: 'contact-naveen',
          contact: { name: 'Naveen Bandary' },
        },
      ];

      // 2. Setup morning digest message in messages table
      messagesTable = [
        {
          message_id: 'wamid.digest-msg-1',
          conversation_id: 'conv-1',
          content_text:
            '☀️ Good morning, Praneeth!\n\n🗓 *Your schedule — Thursday, 20 Aug*\n\n📞 *10:00 am* — Call Naveen Bandary · Naveen Kumar\n\n✅ *Tasks due:*\n• Follow up with Kusumaraju\'s advocate',
        },
      ];

      // 3. Mock parseEventsFromInput to simulate Gemini returning both the completion and the new meeting draft
      const eventParseMock = await import('./event-parse');
      const spy = vi.spyOn(eventParseMock, 'parseEventsFromInput').mockImplementation(async (input) => {
        expect(input.quotedContext).toContain('Call Naveen Bandary');
        expect(input.candidateItems).toBeDefined();
        expect(input.candidateItems?.some((c) => c.id === 'appt-call-naveen')).toBe(true);

        const drafts = [
          {
            intent: 'schedule' as const,
            title: 'Meeting with Naveen Bandary',
            event_type: 'meeting' as const,
            start_time: '2026-08-21T10:00',
            end_time: null,
            duration_minutes: 60,
            contact_name: 'Naveen Bandary',
            counterparty_name: 'Naveen Kumar',
            service_provider_role: null,
            property_hint: null,
            assignee_name: null,
            recipient_name: null,
            location: null,
            priority: 'medium' as const,
            notes: null,
            transcript: null,
            day_of_week: null,
          },
        ];

        Object.defineProperty(drafts, '_fullResult', {
          value: {
            drafts,
            completedItems: [
              {
                id: 'appt-call-naveen',
                type: 'appointment',
                status: 'completed',
                outcome: 'Called, now scheduled to meet him tomorrow morning',
              },
            ],
            updatedItems: [],
            transcript: null,
          },
          enumerable: false,
        });

        return drafts;
      });

      // 4. Run tryHandleOwnerScheduling with quoted message context
      const handled = await tryHandleOwnerScheduling({
        message: {
          id: 'msg-reply-1',
          type: 'text',
          context: { id: 'wamid.digest-msg-1' },
        },
        contentText: 'Called, now scheduled to meet him tomorrow morning',
        contactRecord: { id: 'contact-agent', phone: '+919999988888' },
        conversation: { id: 'conv-1' },
        accountId: 'acc-1',
        userId: 'user-1',
        accessToken: 'meta-token',
        phoneNumberId: 'pnid-1',
      });

      expect(handled).toBe(true);

      // 5. Verify the existing appointment was updated to completed with outcome
      const callAppt = appointmentsTable.find((a) => a.id === 'appt-call-naveen');
      expect(callAppt?.status).toBe('completed');
      expect(callAppt?.outcome).toBe('Called, now scheduled to meet him tomorrow morning');

      // 6. Verify the reply message sent to WhatsApp
      expect(sendTextMessage).toHaveBeenCalledTimes(1);
      const firstCall = sendTextMessage.mock.calls[0] as unknown as [{ text: string }];
      const sentText = firstCall[0].text;
      expect(sentText).toContain('✅ *Marked done on your calendar*');
      expect(sentText).toContain('Call Naveen Bandary · Naveen Kumar');
      expect(sentText).toContain('Called, now scheduled to meet him tomorrow morning');
      expect(sentText).toContain('✅ *Added to your calendar*');
      expect(sentText).toContain('Meeting with Naveen Bandary');
      expect(sentText).toContain('Naveen Bandary');

      spy.mockRestore();
    });

    it('marks a task completed when user quotes digest with task outcome', async () => {
      todosTable = [
        {
          id: 'todo-advocate-1',
          account_id: 'acc-1',
          user_id: 'user-1',
          assigned_to: 'user-1',
          title: "Follow up with Kusumaraju's advocate",
          completed: false,
        },
      ];

      messagesTable = [
        {
          message_id: 'wamid.digest-msg-2',
          conversation_id: 'conv-1',
          content_text: '✅ *Tasks due:*\n• Follow up with Kusumaraju\'s advocate',
        },
      ];

      const eventParseMock = await import('./event-parse');
      const spy = vi.spyOn(eventParseMock, 'parseEventsFromInput').mockImplementation(async () => {
        const drafts: ParsedEventDraft[] = [];
        Object.defineProperty(drafts, '_fullResult', {
          value: {
            drafts: [],
            completedItems: [
              {
                id: 'todo-advocate-1',
                type: 'todo',
                status: 'completed',
                outcome: "Advocate follow up done, agreement is ready",
              },
            ],
            updatedItems: [],
            transcript: null,
          },
          enumerable: false,
        });
        return drafts;
      });

      const handled = await tryHandleOwnerScheduling({
        message: {
          id: 'msg-reply-2',
          type: 'text',
          context: { id: 'wamid.digest-msg-2' },
        },
        contentText: "Advocate follow up done, agreement is ready",
        contactRecord: { id: 'contact-agent', phone: '+919999988888' },
        conversation: { id: 'conv-1' },
        accountId: 'acc-1',
        userId: 'user-1',
        accessToken: 'meta-token',
        phoneNumberId: 'pnid-1',
      });

      expect(handled).toBe(true);
      const todo = todosTable.find((t) => t.id === 'todo-advocate-1');
      expect(todo?.completed).toBe(true);

      const secondCall = sendTextMessage.mock.calls[0] as unknown as [{ text: string }];
      const sentText = secondCall[0].text;
      expect(sentText).toContain('✅ *Task marked done*');
      expect(sentText).toContain("Follow up with Kusumaraju's advocate");

      spy.mockRestore();
    });
  });
});

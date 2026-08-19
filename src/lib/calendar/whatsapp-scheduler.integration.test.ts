import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const parseEventsFromInput = vi.fn();
const burnCredits = vi.fn();
const sendTextMessage = vi.fn();
const sendWhatsAppMessageAndPersist = vi.fn();
const createNotification = vi.fn();
const recordBotTarget = vi.fn();
const loadTemplateForContact = vi.fn();
const warnLanguageFallback = vi.fn();
const canSendToEveryLead = vi.fn();

vi.mock('@/lib/calendar/event-parse', async () => {
  const actual = await vi.importActual<typeof import('./event-parse')>('./event-parse');
  return {
    ...actual,
    parseEventsFromInput: (...args: unknown[]) => parseEventsFromInput(...args),
  };
});

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...args: unknown[]) => burnCredits(...args),
}));

vi.mock('@/lib/whatsapp/bot-message-target', () => ({
  recordBotTarget: (...args: unknown[]) => recordBotTarget(...args),
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/whatsapp/template-language', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/whatsapp/template-language')
  >('@/lib/whatsapp/template-language');
  return {
    ...actual,
    loadTemplateForContact: (...args: unknown[]) => loadTemplateForContact(...args),
    warnLanguageFallback: (...args: unknown[]) => warnLanguageFallback(...args),
  };
});

vi.mock('@/lib/reengagement/template-gate', () => ({
  canSendToEveryLead: (...args: unknown[]) => canSendToEveryLead(...args),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...args: unknown[]) => sendTextMessage(...args),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

import { tryHandleOwnerScheduling } from './whatsapp-scheduler';

const testContact = '+919000000011';

describe.skipIf(!SUPABASE_URL || !SERVICE_ROLE_KEY)(
  'owner scheduling compound notify + reminder flow (integration, real database)',
  () => {
    let admin: SupabaseClient;
    let ownerUserId: string;
    let accountId: string;
    let conversationId: string;
    let conversationContactId: string;

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
      const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const email = `convoreal-scheduler-e2e-${stamp}@convoreal-test.invalid`;
      const password = crypto.randomUUID();
      const { data: created, error: userErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'ConvoReal Flow Test' },
      });
      if (userErr || !created.user) {
        throw new Error(`failed to create test user: ${userErr?.message}`);
      }
      ownerUserId = created.user.id;

      const { data: account } = await admin
        .from('accounts')
        .select('id')
        .eq('owner_user_id', ownerUserId)
        .maybeSingle();
      if (!account) {
        throw new Error('handle_new_user() did not create an account for test user');
      }
      accountId = account.id as string;

      const { data: contacts, error: contactErr } = await admin
        .from('contacts')
        .insert([
          {
            account_id: accountId,
            user_id: ownerUserId,
            name: 'Owner Contact',
            phone: `91900000${stamp.slice(-6)}`,
          },
          {
            account_id: accountId,
            user_id: ownerUserId,
            name: 'C Kumar',
            phone: testContact.replace('+', ''),
          },
        ])
        .select('id');
      if (contactErr || !contacts || contacts.length < 2) {
        throw new Error(`failed to seed contacts: ${contactErr?.message}`);
      }
      [conversationContactId] = contacts.map((c) => c.id as string);

      const { data: conversations, error: convoErr } = await admin
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: ownerUserId,
          contact_id: conversationContactId,
          status: 'open',
          is_archived: false,
          source: 'whatsapp',
        })
        .select('id');
      if (convoErr || !conversations?.length) {
        throw new Error(`failed to seed conversation: ${convoErr?.message}`);
      }
      conversationId = conversations[0].id as string;

      parseEventsFromInput.mockResolvedValue([
        {
          intent: 'notify',
          title: 'Update about Jayanagar plot',
          event_type: 'other',
          start_time: null,
          end_time: null,
          duration_minutes: null,
          contact_name: null,
          counterparty_name: null,
          service_provider_role: null,
          property_hint: null,
          assignee_name: null,
          recipient_name: 'C Kumar',
          location: null,
          priority: 'medium',
          notes: "Suleiman's 9,600 sqft Jayanagar plot has been approved by owner.",
          transcript: null,
          day_of_week: null,
        },
        {
          intent: 'task',
          title: 'Follow up with C Kumar',
          event_type: 'other',
          start_time: '2026-09-24T10:00',
          end_time: null,
          duration_minutes: null,
          contact_name: null,
          counterparty_name: null,
          service_provider_role: null,
          property_hint: null,
          assignee_name: null,
          recipient_name: null,
          location: null,
          priority: 'medium',
          notes: 'Reminder on 9,600 sqft Jayanagar plot progress',
          transcript: null,
          day_of_week: null,
        },
      ]);
      burnCredits.mockResolvedValue({ success: true });
      sendTextMessage.mockResolvedValue({ messageId: 'wamid.test' });
      sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
      loadTemplateForContact.mockResolvedValue({
        template: null,
        language: 'en_US',
        fellBack: false,
      });
      canSendToEveryLead.mockReturnValue(true);
      recordBotTarget.mockResolvedValue(undefined);
      createNotification.mockResolvedValue({
        inAppId: 'notif-1',
        whatsapp: { success: true },
        pushCount: 1,
      });
    });

    afterAll(async () => {
      if (!admin || !accountId) return;
      try {
        await admin.from('todos').delete().eq('account_id', accountId);
        await admin.from('conversations').delete().eq('account_id', accountId);
        await admin.from('contacts').delete().eq('account_id', accountId);
        await admin.from('accounts').delete().eq('id', accountId);
      } finally {
        if (ownerUserId) {
          await admin.auth.admin.deleteUser(ownerUserId);
        }
      }
    });

    it('creates C Kumar WhatsApp update plus a September 24 task in one flow', async () => {
      await tryHandleOwnerScheduling({
        message: { id: 'wa-int', type: 'text' },
        contentText:
          "Can you update C Kumar about Suleiman's client / 9,600 sqft Jayanagar plot and set a reminder for September 24?",
        contactRecord: {
          id: conversationContactId,
          phone: testContact,
        },
        conversation: {
          id: conversationId,
        },
        accountId,
        userId: ownerUserId,
        accessToken: 'fake-token',
        phoneNumberId: 'fake-phone-id',
      });

      const { data: todos, error } = await admin
        .from('todos')
        .select('id,title,due_date')
        .eq('account_id', accountId)
        .eq('title', 'Follow up with C Kumar');
      if (error) {
        throw new Error(`failed to fetch todos: ${error.message}`);
      }

      expect(todos).toHaveLength(1);
      expect(todos?.[0].due_date).toBe('2026-09-24T04:30:00.000Z');
      expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
      expect(createNotification).not.toHaveBeenCalled();
      const confirmation = sendTextMessage.mock.calls[0]?.[0]?.text as string | undefined;
      expect(confirmation).toContain('📨 *Update sent to C Kumar*');
      expect(confirmation).toContain('✅ *Task added to your list*');
      expect(confirmation).not.toContain('Task updated');
    });
  }
);

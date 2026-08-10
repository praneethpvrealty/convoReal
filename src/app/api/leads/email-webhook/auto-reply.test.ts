import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailSyncConfig } from '@/types';

const sendTemplateMessage = vi.fn();

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessage(...args),
  sendTextMessage: vi.fn(),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
}));

const { sendAutoReply } = await import('./auto-reply');

interface Write {
  table: string;
  op: 'insert' | 'update';
  payload: Record<string, unknown>;
}

function mockSupabase(writes: Write[]) {
  const rows: Record<string, unknown> = {
    whatsapp_config: { phone_number_id: 'pn-1', access_token: 'cipher' },
    message_templates: {
      id: 'tpl-1',
      name: 'portal_lead_ack',
      language: 'en_US',
      body_text: 'Hi {{1}}, thanks for your interest via {{2}}.',
      buttons: null,
    },
  };

  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      insert: async (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', payload });
        return { data: null, error: null };
      },
      update: (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'update', payload });
        return {
          ...builder,
          eq: () => ({
            select: async () => ({ data: [{ id: 'conv-1' }], error: null }),
          }),
        };
      },
    };
    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

const syncConfig = {
  auto_reply_enabled: true,
  auto_reply_template_name: 'portal_lead_ack',
} as unknown as EmailSyncConfig;

describe('sendAutoReply conversation bookkeeping', () => {
  beforeEach(() => {
    sendTemplateMessage.mockReset();
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });
  });

  it('clears awaiting_reply once the bot has answered the lead', async () => {
    const writes: Write[] = [];
    const result = await sendAutoReply({
      supabase: mockSupabase(writes),
      accountId: 'acc-1',
      syncConfig,
      conversationId: 'conv-1',
      cleanPhone: '919999999999',
      leadName: 'Monish',
      leadSource: 'Housing',
      forceSend: true,
    });

    expect(result.success).toBe(true);

    const update = writes.find(
      (w) => w.table === 'conversations' && w.op === 'update'
    );
    expect(update?.payload.awaiting_reply).toBe(false);
  });

  it('moves the inbox preview onto the message it just sent', async () => {
    const writes: Write[] = [];
    await sendAutoReply({
      supabase: mockSupabase(writes),
      accountId: 'acc-1',
      syncConfig,
      conversationId: 'conv-1',
      cleanPhone: '919999999999',
      leadName: 'Monish',
      leadSource: 'Housing',
      forceSend: true,
    });

    const message = writes.find((w) => w.table === 'messages');
    const update = writes.find((w) => w.table === 'conversations');
    expect(update?.payload.last_message_text).toBe(
      message?.payload.content_text
    );
    expect(update?.payload.last_message_at).toBe(message?.payload.created_at);
  });

  it('never claims the lead wrote to us on WhatsApp', async () => {
    const writes: Write[] = [];
    await sendAutoReply({
      supabase: mockSupabase(writes),
      accountId: 'acc-1',
      syncConfig,
      conversationId: 'conv-1',
      cleanPhone: '919999999999',
      leadName: 'Monish',
      leadSource: 'Housing',
      forceSend: true,
    });

    for (const write of writes) {
      expect(write.payload).not.toHaveProperty('last_customer_message_at');
    }
  });

  it('leaves the thread flagged when no template could be sent', async () => {
    sendTemplateMessage.mockRejectedValue(new Error('132001 does not exist'));
    const writes: Write[] = [];
    const result = await sendAutoReply({
      supabase: mockSupabase(writes),
      accountId: 'acc-1',
      syncConfig,
      conversationId: 'conv-1',
      cleanPhone: '919999999999',
      leadName: 'Monish',
      leadSource: 'Housing',
      forceSend: true,
    });

    expect(result.success).toBe(false);
    expect(
      writes.some((w) => w.table === 'conversations' && w.op === 'update')
    ).toBe(false);
  });
});

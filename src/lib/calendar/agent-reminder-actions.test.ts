import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const loadTemplateForContact = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (args: unknown) =>
    sendWhatsAppMessageAndPersist(args),
}));

vi.mock('@/lib/whatsapp/template-language', () => ({
  loadTemplateForContact: (...args: unknown[]) =>
    loadTemplateForContact(...args),
  warnLanguageFallback: vi.fn(),
}));

import {
  agentMessageButtonTitle,
  buildAgentMessageContactReplyId,
  handleAgentMessageContactReply,
  parseAgentMessageContactReplyId,
} from './agent-reminder-actions';

type Row = Record<string, unknown>;

function makeAdmin(options: { claimError?: Row | null } = {}) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const deletes: Row[] = [];

  const rows: Record<string, Row> = {
    appointments: {
      id: 'appointment-1',
      account_id: 'account-1',
      user_id: 'agent-1',
      assigned_to: 'agent-1',
      title: 'Connect with Nadeem',
      event_type: 'call',
      start_time: '2026-08-17T04:30:00.000Z',
      location: null,
      status: 'scheduled',
      contact_id: 'contact-1',
      contact_ids: ['contact-1'],
      property: null,
      account: { name: 'Aryavarta Ventures' },
    },
    profiles: { phone: '+919900277111' },
    contacts: {
      id: 'contact-1',
      name: 'Nadeem',
      phone: '+919886140608',
    },
  };

  function builder(table: string) {
    const filters: Row = {};
    const chain: Row = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve({ data: rows[table] ?? null, error: null }),
      insert: (payload: Row) => {
        inserts.push(payload);
        return Promise.resolve({ error: options.claimError ?? null });
      },
      update: (payload: Row) => {
        updates.push(payload);
        return chain;
      },
      delete: () => {
        deletes.push({ table, ...filters });
        return chain;
      },
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table),
    _inserts: inserts,
    _updates: updates,
    _deletes: deletes,
  };
}

beforeEach(() => {
  sendWhatsAppMessageAndPersist
    .mockReset()
    .mockImplementation((args: Row) =>
      Promise.resolve(
        args.kind === 'template'
          ? { success: true, whatsappMessageId: 'wamid.manual-1' }
          : { success: true }
      )
    );
  loadTemplateForContact.mockReset().mockResolvedValue({
    template: {
      name: 'appointment_reminder',
      language: 'en_US',
      status: 'APPROVED',
      category: 'Utility',
      body_text: 'approved body',
      buttons: [],
    },
    language: 'en',
    fellBack: false,
  });
});

describe('agent reminder contact actions', () => {
  it('round-trips the appointment and contact ids', () => {
    const id = buildAgentMessageContactReplyId('appointment-1', 'contact-1');
    expect(parseAgentMessageContactReplyId(id)).toEqual({
      appointmentId: 'appointment-1',
      contactId: 'contact-1',
    });
    expect(parseAgentMessageContactReplyId('arm_msg:missing')).toBeNull();
  });

  it('keeps the WhatsApp action title within 20 characters', () => {
    expect(agentMessageButtonTitle('Nadeem Khan')).toBe('Message Nadeem');
    expect(
      Array.from(agentMessageButtonTitle('Venkatanarasimharaju')).length
    ).toBe(20);
  });

  it('sends the approved Utility template and records the appointment link', async () => {
    const admin = makeAdmin();

    const handled = await handleAgentMessageContactReply({
      admin: admin as never,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      agentContactId: 'agent-contact',
      agentConversationId: 'agent-conversation',
      replyId: 'arm_msg:appointment-1:contact-1',
      senderPhone: '+91 99002 77111',
    });

    expect(handled).toBe(true);
    expect(admin._inserts).toContainEqual({
      account_id: 'account-1',
      appointment_id: 'appointment-1',
      contact_id: 'contact-1',
      reminder_type: 'manual',
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'agent-1',
        contactId: 'contact-1',
        kind: 'template',
        senderType: 'agent',
        templateName: 'appointment_reminder',
        templateParams: [
          'Nadeem',
          'Connect with Nadeem',
          '17/08/2026, 10:00 am',
          'Phone call',
          'Aryavarta Ventures',
        ],
      })
    );
    expect(admin._updates).toContainEqual({ wa_message_id: 'wamid.manual-1' });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'agent-contact',
        conversationId: 'agent-conversation',
        kind: 'text',
        text: expect.stringContaining('tracked in the Inbox'),
      })
    );
  });

  it('does not send again when the manual reminder was already claimed', async () => {
    const admin = makeAdmin({ claimError: { code: '23505' } });

    await handleAgentMessageContactReply({
      admin: admin as never,
      accountId: 'account-1',
      ownerUserId: 'owner-1',
      agentContactId: 'agent-contact',
      agentConversationId: 'agent-conversation',
      replyId: 'arm_msg:appointment-1:contact-1',
      senderPhone: '+919900277111',
    });

    expect(
      sendWhatsAppMessageAndPersist.mock.calls.some(
        ([call]) => (call as Row).kind === 'template'
      )
    ).toBe(false);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('already messaged'),
      })
    );
  });
});

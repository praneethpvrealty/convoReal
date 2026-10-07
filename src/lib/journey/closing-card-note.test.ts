import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inboundChainSource } from '@/lib/whatsapp/inbound/chain/test-source';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  upserts: [] as { table: string; row: Record<string, unknown> }[],
  sent: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let rows = state.tables[table] ?? [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((r) => r[column] === value);
          return chain;
        },
        in: (column: string, value: unknown[]) => {
          rows = rows.filter((r) => value.includes(r[column]));
          return chain;
        },
        not: (column: string, operator: string, value: unknown) => {
          if (operator === 'is' && value === null) {
            rows = rows.filter(
              (r) => r[column] !== null && r[column] !== undefined
            );
          }
          return chain;
        },
        like: (column: string, pattern: string) => {
          const suffix = pattern.replace(/^%/, '');
          rows = rows.filter((r) => String(r[column] ?? '').endsWith(suffix));
          return chain;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        insert: async (row: Record<string, unknown>) => {
          state.inserts.push({ table, row });
          return { error: null };
        },
        upsert: async (row: Record<string, unknown>) => {
          state.upserts.push({ table, row });
          return { error: null };
        },
      };
      (chain as { then: unknown }).then = (
        resolve: (v: { data: unknown }) => void
      ) => resolve({ data: rows });
      return chain;
    },
  }),
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: Record<string, unknown>) => {
    state.sent.push(args);
    return { success: true };
  },
}));

import {
  buildClosingCardBody,
  handleQuotedClosingNote,
  parseClosingCardSubject,
  type ClosingDeal,
} from './closing-nudges';

const ACCOUNT = 'acct-1';
const AGENT_THREAD = { contactId: 'agent-contact', conversationId: 'conv-1' };
const CARD_WAMID = 'wamid.closing-card';

const deal: ClosingDeal = {
  itemId: 'item-1',
  contactId: 'c-anand',
  name: 'KP Anand',
  phone: '+919994035636',
  assignedAgentUserId: null,
  propertyTitle: 'Residential Plot in Sector 6 HSR Layout',
  stageName: 'Token & Legal',
  nextStageName: 'Agreement',
  daysStalled: 16,
};

const stage = (id: string, name: string, position: number, kind: string) => ({
  id,
  name,
  position,
  stage_kind: kind,
  account_id: ACCOUNT,
  pipeline_stage_id: `ps-${id}`,
});

function seed(cardBody: string = buildClosingCardBody(deal)) {
  state.tables = {
    messages: [
      {
        conversation_id: AGENT_THREAD.conversationId,
        message_id: CARD_WAMID,
        sender_type: 'bot',
        content_text: cardBody,
      },
    ],
    journey_stages: [
      stage('s-shared', 'Shared', 0, 'prospecting'),
      stage('s-legal', 'Token & Legal', 1, 'closing'),
      stage('s-agree', 'Agreement', 2, 'closing'),
    ],
    contacts: [
      {
        id: 'c-anand',
        account_id: ACCOUNT,
        name: 'KP Anand',
        phone: '919994035636',
      },
      {
        id: 'c-sulekha',
        account_id: ACCOUNT,
        name: 'Sulekha S',
        phone: '919900000001',
      },
    ],
    journey_items: [
      {
        id: 'item-1',
        account_id: ACCOUNT,
        contact_id: 'c-anand',
        property_id: 'p-hsr',
        stage_id: 's-legal',
        status: 'active',
      },
    ],
    properties: [
      {
        id: 'p-hsr',
        account_id: ACCOUNT,
        title: 'Residential Plot in Sector 6 HSR Layout',
      },
    ],
  };
}

function note(text: string, contextId = CARD_WAMID) {
  return handleQuotedClosingNote({
    accountId: ACCOUNT,
    configOwnerUserId: 'owner-1',
    agentThread: AGENT_THREAD,
    contextId,
    text,
  });
}

beforeEach(() => {
  state.inserts = [];
  state.upserts = [];
  state.sent = [];
  seed();
});

describe('parseClosingCardSubject', () => {
  it('reads the buyer phone and listing back out of the card it built', () => {
    expect(parseClosingCardSubject(buildClosingCardBody(deal))).toEqual({
      phone: '+919994035636',
      propertyTitle: 'Residential Plot in Sector 6 HSR Layout',
    });
  });

  it('takes the addressed member of a party card', () => {
    const body = buildClosingCardBody({ ...deal, partyName: 'Anand family' });
    expect(parseClosingCardSubject(body)?.phone).toBe('+919994035636');
  });

  it('has no listing when the card names none', () => {
    const body = buildClosingCardBody({ ...deal, propertyTitle: null });
    expect(parseClosingCardSubject(body)?.propertyTitle).toBeNull();
  });

  it('ignores every message that is not a closing card', () => {
    for (const body of [
      null,
      '',
      '📊 *Follow-up radar*\n👤 KP Anand · +919994035636',
      'Legal done → Agreement next',
    ]) {
      expect(parseClosingCardSubject(body), String(body)).toBeNull();
    }
  });
});

describe('[JRN-020] handleQuotedClosingNote', () => {
  it('files the agent note on the quoted deal without asking who it is', async () => {
    expect(await note('Legal done → Agreement next week')).toBe(true);

    const event = state.inserts.find((i) => i.table === 'journey_events');
    expect(event?.row).toMatchObject({
      account_id: ACCOUNT,
      item_id: 'item-1',
      event_type: 'client_response',
      reason: 'Agent update: Legal done → Agreement next week',
    });
    const contactNote = state.inserts.find((i) => i.table === 'contact_notes');
    expect(contactNote?.row).toMatchObject({
      contact_id: 'c-anand',
      account_id: ACCOUNT,
    });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      contactId: AGENT_THREAD.contactId,
      conversationId: AGENT_THREAD.conversationId,
    });
    const reply = String(state.sent[0].text);
    expect(reply).toContain("Noted on KP Anand's deal");
    expect(reply).toContain('Tap ✅ Agreement');
    expect(reply).not.toMatch(/Is it one of these|couldn't work out/);
  });

  it('never messages the buyer', async () => {
    await note('Legal done');
    expect(state.sent.every((s) => s.contactId !== 'c-anand')).toBe(true);
  });

  it('holds the card back for the re-nudge period', async () => {
    await note('Legal done');
    expect(
      state.upserts.find((u) => u.table === 'closing_deal_nudges')?.row
    ).toMatchObject({ account_id: ACCOUNT, item_id: 'item-1' });
  });

  it('leaves a quote of any other message to the paths below', async () => {
    expect(await note('Legal done', 'wamid.something-else')).toBe(false);
    seed('📊 Follow-up radar\n👤 KP Anand · +919994035636');
    expect(await note('Legal done')).toBe(false);
    expect(state.sent).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('only reads cards from the sender’s own thread', async () => {
    const result = await handleQuotedClosingNote({
      accountId: ACCOUNT,
      configOwnerUserId: 'owner-1',
      agentThread: { contactId: 'someone-else', conversationId: 'conv-2' },
      contextId: CARD_WAMID,
      text: 'Legal done',
    });
    expect(result).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it('says so rather than guessing when the deal has left the board', async () => {
    state.tables.journey_items = [];
    expect(await note('Legal done')).toBe(true);
    expect(state.inserts).toHaveLength(0);
    expect(String(state.sent[0].text)).toContain("couldn't find that deal");
  });

  it('picks the quoted listing when the buyer is closing on two', async () => {
    state.tables.journey_items.push({
      id: 'item-2',
      account_id: ACCOUNT,
      contact_id: 'c-anand',
      property_id: 'p-jp',
      stage_id: 's-legal',
      status: 'active',
    });
    state.tables.properties.push({
      id: 'p-jp',
      account_id: ACCOUNT,
      title: 'JP Nagar Villa',
    });
    await note('Legal done');
    expect(
      state.inserts.find((i) => i.table === 'journey_events')?.row.item_id
    ).toBe('item-1');
  });
});

describe('[JRN-020] the quoted closing note is wired up', () => {
  it('runs before the reply bridge and the owner chatbot', () => {
    const source = inboundChainSource();
    const closingNote = source.indexOf('handleQuotedClosingNote({');
    const ownerChatbot = source.indexOf('processOwnerChatbotMessage(');
    expect(closingNote).toBeGreaterThan(-1);
    expect(ownerChatbot).toBeGreaterThan(-1);
    expect(closingNote).toBeLessThan(ownerChatbot);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySupabase } from '@/test/memory-supabase';
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from '@/lib/whatsapp/customer-window';
import { templateBody } from '@/lib/whatsapp/template-copy';
import type { InboundChainContext } from '@/lib/whatsapp/inbound/chain/context';
import {
  checkTranscript,
  botTurns,
  type TranscriptMessage,
} from './transcript-rules';

/**
 * The 7 October 2026 JP Nagar thread, replayed through the real code:
 * a 99acres lead on an Under Contract plot arrives, taps "Update my
 * preferences", then "Show Properties". Every reply builder, the
 * matcher, the near-miss search and the showcase links run for real
 * against an in-memory inventory; only the wire (Meta, the welcome
 * template sender, the interactive list senders) is stubbed into an
 * outbox. The assertions read the outbox the way the lead read their
 * phone (CNV-004).
 */

type Row = Record<string, unknown>;

const ACCOUNT = 'acc-1';
const USER = 'user-1';
const CONTACT = 'c-shirish';
const CONVERSATION = 'conv-1';
const NOW = '2026-10-07T10:14:47.000Z';

interface Outbound {
  kind: string;
  text: string;
  templateName?: string | null;
}

let tables: Record<string, Row[]>;
let db: ReturnType<typeof memorySupabase>;
let outbox: Outbound[];
let transcript: TranscriptMessage[];

function hasCustomerMessage(conversationId: string) {
  return (tables.messages ?? []).some(
    (m) => m.conversation_id === conversationId && m.sender_type === 'customer'
  );
}

function botSent(kind: string, text: string, templateName?: string | null) {
  tables.messages.push({
    conversation_id: CONVERSATION,
    sender_type: 'bot',
    content_type: kind,
    content_text: text,
    template_name: templateName ?? null,
    status: 'sent',
    created_at: new Date().toISOString(),
  });
  outbox.push({ kind, text, templateName });
  transcript.push({
    sender: 'bot',
    kind: kind as TranscriptMessage['kind'],
    text,
    templateName,
  });
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db }));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async (args: {
    kind: string;
    text?: string;
    interactiveBody?: string;
    templateName?: string;
    conversationId?: string;
  }) => {
    // Meta refuses free-form text to a number that has not written in
    // the last 24 hours; a brand-new portal lead never has.
    if (
      args.kind === 'text' &&
      !hasCustomerMessage(args.conversationId ?? CONVERSATION)
    ) {
      return { success: false, error: CUSTOMER_WINDOW_EXPIRED_MESSAGE };
    }
    botSent(
      args.kind,
      args.text ?? args.interactiveBody ?? '',
      args.templateName ?? null
    );
    return { success: true, messageId: `m-${outbox.length}` };
  },
}));

vi.mock('@/app/api/leads/email-webhook/auto-reply', () => ({
  sendAutoReply: async (args: { leadName: string; leadSource: string }) => {
    botSent(
      'template',
      `Hi ${args.leadName}, thanks for your interest in the property listed on ${args.leadSource}. Kindly let me know your requirements and budget, I will share the appropriate properties.`,
      'lead_welcome_utility'
    );
    return { success: true, messageId: 'welcome' };
  },
}));

vi.mock('@/lib/whatsapp/meta-flow-service', () => ({
  getPublishedPreferenceFlow: async () => ({
    id: 'flow-1',
    meta_flow_id: 'f1',
  }),
  sendPreferenceFlowToContact: async (args: { bodyText?: string }) => {
    botSent(
      'interactive',
      args.bodyText ??
        'Tap below to tell us what you are looking for — it takes under a minute.'
    );
    return { success: true };
  },
}));

vi.mock('@/lib/whatsapp/listing-feedback', () => ({
  sendListingFeedbackPrompt: async (args: {
    matches: Array<{ property: { title: string } }>;
  }) => {
    botSent(
      'interactive',
      `Which of these fits? ${args.matches.map((m) => m.property.title).join(' / ')}`
    );
    return true;
  },
}));

vi.mock('@/lib/whatsapp/budget-band', () => ({
  sendBudgetBandPrompt: async (args: { bodyText?: string }) => {
    botSent('interactive', args.bodyText ?? 'Pick your budget range');
    return true;
  },
}));

vi.mock('@/lib/whatsapp/listing-intent-prompt', () => ({
  sendListingIntentPrompt: async () => {
    botSent('interactive', 'Buying or renting?');
    return true;
  },
  applyDefaultBuyingIntent: async () => false,
}));

vi.mock('@/lib/whatsapp/share-property-send', () => ({
  logListingsSent: async (
    _db: unknown,
    accountId: string,
    _userId: string | null,
    contactId: string,
    propertyIds: string[]
  ) => {
    for (const property_id of propertyIds)
      tables.property_shares.push({
        account_id: accountId,
        contact_id: contactId,
        property_id,
      });
  },
}));

vi.mock('@/lib/radar/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/radar/engine')>()),
  generateMatchEventForContact: async () => undefined,
}));

vi.mock('@/lib/whatsapp/template-language', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/template-language')
  >()),
  resolveSendLanguage: async () => 'en',
}));

const { sendLeadArrivalReplies } =
  await import('@/app/api/leads/email-webhook/lead-replies');
const { preferenceFlowRequest } =
  await import('@/lib/whatsapp/inbound/chain/steps/preference-flow-request');
const { buyerMatchesCommand } =
  await import('@/lib/whatsapp/inbound/chain/steps/buyer-matches-command');

const plot = (over: Row): Row => ({
  account_id: ACCOUNT,
  type: 'Commercial Land',
  listing_type: 'Sale',
  status: 'Available',
  is_published: true,
  city: 'Bangalore',
  land_area: 2400,
  land_area_unit: 'Sq.Ft.',
  images: [],
  features: [],
  created_at: '2026-09-01T00:00:00Z',
  ...over,
});

const ENQUIRED: Row = plot({
  id: 'p-20',
  title: '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
  status: 'Under Contract',
  sublocality: 'JP Nagar 4th Phase',
  location: 'JP Nagar 4th Phase, Bangalore, Karnataka',
  price: 84000000,
  latitude: 12.9068,
  longitude: 77.6268,
  property_code: 'PROP-20',
});

const SECOND_PHASE: Row = plot({
  id: 'p-2nd',
  title: 'Prime Commercial Site for Sale',
  type: 'Commercial Plot',
  sublocality: 'JP Nagar 2nd Phase',
  location: 'JP Nagar 2nd Phase, Bangalore',
  price: 96000000,
  latitude: 12.9119,
  longitude: 77.5951,
  property_code: 'PROP-2ND',
});

const FIFTH_PHASE: Row = plot({
  id: 'p-5th',
  title: '60x90 Commercial Plot in JP Nagar, 5th Phase',
  sublocality: 'JP Nagar 5th Phase',
  location: 'JP Nagar 5th Phase, Bangalore',
  price: 190000000,
  land_area: 5400,
  latitude: 12.9064,
  longitude: 77.5773,
  property_code: 'PROP-5TH',
});

const SIXTH_PHASE: Row = plot({
  id: 'p-6th',
  title: '60x90 Commercial Land in JP Nagar 6th Phase',
  sublocality: 'JP Nagar 6th Phase',
  location: 'JP Nagar 6th Phase, Bangalore',
  price: 216000000,
  land_area: 5400,
  latitude: 12.9062,
  longitude: 77.5766,
  property_code: 'PROP-6TH',
});

const WHITEFIELD_VILLA: Row = plot({
  id: 'p-villa',
  title: '4 BHK Villa in Whitefield',
  type: 'Villa',
  sublocality: 'Whitefield',
  location: 'Whitefield, Bangalore',
  price: 70000000,
  land_area: null,
  area_sqft: 3200,
  bedrooms: 4,
  latitude: 12.9698,
  longitude: 77.75,
  property_code: 'PROP-VILLA',
});

function seed(inventory: Row[]) {
  outbox = [];
  transcript = [];
  tables = {
    accounts: [{ id: ACCOUNT, name: 'Aryavarta Ventures' }],
    showcase_settings: [],
    // The lead as the email webhook files it after an exact portal
    // match: the portal's wording of the area beside the listing's own,
    // the listing's price as the budget anchor, the listing enquired.
    contacts: [
      {
        id: CONTACT,
        account_id: ACCOUNT,
        user_id: USER,
        name: 'shirish',
        phone: '+919900000000',
        classification: 'Buyer',
        status: 'pending_review',
        source: '99acres',
        pref_areas: ['Dollars Colony', 'JP Nagar 4th Phase'],
        property_interests: ['Commercial'],
        pref_budget_max: 84000000,
        pref_budget_anchor: 84000000,
        pref_extracted_at: NOW,
        last_inquired_property_id: 'p-20',
        requirement_active: true,
        created_at: NOW,
      },
    ],
    conversations: [
      {
        id: CONVERSATION,
        account_id: ACCOUNT,
        contact_id: CONTACT,
        user_id: USER,
        status: 'open',
        unread_count: 0,
        assigned_agent_id: null,
        assigned_team_id: null,
        is_archived: false,
      },
    ],
    properties: inventory,
    messages: [],
    listing_feedback: [],
    property_shares: [],
    message_templates: [
      {
        id: 'tpl-notice',
        account_id: ACCOUNT,
        name: 'listing_status_notice',
        language: 'en_US',
        category: 'Utility',
        status: 'APPROVED',
        body_text: templateBody('enquiry_notice', 'en'),
        buttons: [
          { text: 'Update my preferences', type: 'QUICK_REPLY' },
          { text: 'Close my enquiry', type: 'QUICK_REPLY' },
        ],
      },
    ],
  };
  db = memorySupabase(tables, {
    contacts_inquired_listing_types: () => [
      { contact_id: CONTACT, listing_types: ['Sale'] },
    ],
  });
}

async function arrive() {
  return sendLeadArrivalReplies({
    supabase: db as never,
    accountId: ACCOUNT,
    userId: USER,
    syncConfig: null,
    contactId: CONTACT,
    conversationId: CONVERSATION,
    cleanPhone: '919900000000',
    leadName: 'shirish',
    leadSource: '99acres',
    matchedPropertyId: 'p-20',
  });
}

function tap(buttonText: string): InboundChainContext {
  const text = `🔘 Button: "${buttonText}"`;
  tables.messages.push({
    conversation_id: CONVERSATION,
    sender_type: 'customer',
    content_type: 'text',
    content_text: text,
    status: 'delivered',
    created_at: new Date().toISOString(),
  });
  transcript.push({ sender: 'customer', kind: 'text', text });
  return {
    accountId: ACCOUNT,
    accessToken: 'token',
    message: {
      id: `wamid-${transcript.length}`,
      from: '919900000000',
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'button',
      button: { text: buttonText, payload: buttonText },
    },
    configOwnerUserId: USER,
    phoneNumberId: 'pn-1',
    senderPhone: '919900000000',
    contactWasCreated: false,
    contentText: null,
    interactiveReplyId: null,
    nfmResponseJson: null,
    routingUpdate: {},
    enquiryPropertyId: null,
    enquiryIsDeliberate: false,
    enquiryPropertyTitle: null,
    enquiryPropertyStatus: null,
    specificPropertyInterest: false,
    propertyReferenceNeedsAgent: false,
    ownerCheck: { isOwner: false } as InboundChainContext['ownerCheck'],
    contactRecord: tables
      .contacts[0] as unknown as InboundChainContext['contactRecord'],
    conversation: tables
      .conversations[0] as unknown as InboundChainContext['conversation'],
    waited: false,
    isFirstInboundMessage: false,
    isControlReply: false,
    assignedAgentUserId: USER,
    isTextMessage: false,
    buyerRequirementMessage: false,
    ownedListings: [],
    isPropertyOwnerSender: false,
    agentHandling: false,
    inboundText: '',
    tappedHumanRequest: null,
    flowConsumed: false,
  };
}

const botTextsSince = (from: number) =>
  transcript.slice(from).filter((m) => m.sender === 'bot');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.convoreal.com';
});

describe('[CNV-004] a portal lead on an unavailable listing, replayed end to end', () => {
  it('is greeted once, shown the live plot two phases over, and never told "nothing" twice', async () => {
    seed([ENQUIRED, SECOND_PHASE, FIFTH_PHASE, SIXTH_PHASE, WHITEFIELD_VILLA]);

    const arrival = await arrive();
    expect(arrival.notice).toBe('template');
    expect(outbox).toHaveLength(1);
    expect(outbox[0].templateName).toBe('listing_status_notice');
    expect(outbox[0].text).toContain(
      'Property: #20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase, Bangalore'
    );
    expect(outbox[0].text).not.toContain('4th Phase., JP Nagar');
    expect(outbox[0].text).not.toContain('I will share');

    let from = transcript.length;
    expect(await preferenceFlowRequest(tap('Update my preferences'))).toBe(
      'handled'
    );
    const tapReplies = botTextsSince(from);
    expect(tapReplies.length).toBeLessThanOrEqual(2);
    const [reply] = tapReplies;
    expect(reply.text).toContain('Thanks for getting back to us, shirish');
    expect(reply.text).toContain("here's one live option");
    expect(reply.text).toContain('*Prime Commercial Site for Sale*');
    expect(reply.text).toContain('property_id=PROP-2ND');
    expect(reply.text).not.toContain('60x90');
    expect(reply.text).not.toContain('Whitefield');
    expect(reply.text).toContain(
      'Browse every live listing any time: https://www.convoreal.com/?ref=acc-1&v=c-shirish'
    );
    expect(reply.text).not.toMatch(/radar|intelligent/i);

    from = transcript.length;
    expect(await buyerMatchesCommand(tap('Show Properties'))).toBe('handled');
    const [matches] = botTextsSince(from);
    expect(botTextsSince(from)).toHaveLength(1);
    expect(matches.text).toContain('Prime Commercial Site for Sale');
    expect(matches.text).not.toContain('no longer available');

    expect(botTurns(transcript).map((turn) => turn.indexes.length)).toEqual([
      1, 2, 1,
    ]);
    expect(checkTranscript(transcript, { contactCreatedAt: NOW })).toEqual([]);
  });

  it('names the locality stock at another price and the showcase on a true dead end', async () => {
    seed([ENQUIRED, FIFTH_PHASE, SIXTH_PHASE, WHITEFIELD_VILLA]);

    await arrive();
    let from = transcript.length;
    expect(await preferenceFlowRequest(tap('Update my preferences'))).toBe(
      'handled'
    );
    const [reply, form] = botTextsSince(from);
    expect(reply.text).toContain(
      'Nothing live right now fits your requirement exactly'
    );
    expect(reply.text).toContain(
      '📍 We do have 2 listings in JP Nagar, at ₹19 Cr–₹21.6 Cr'
    );
    expect(reply.text).toContain(
      'Browse every live listing any time: https://www.convoreal.com/?ref=acc-1&v=c-shirish'
    );
    expect(reply.text).toMatch(/just reply here\.$/);
    expect(form.text).toContain('Prefer to update everything at once');

    from = transcript.length;
    expect(await buyerMatchesCommand(tap('Show Properties'))).toBe('handled');
    const [matches] = botTextsSince(from);
    expect(matches.text).not.toContain('no longer available');
    expect(matches.text).toContain("I don't have");
    expect(matches.text).toContain('📍 We do have 2 listings in JP Nagar');
    expect(matches.text).toContain('Browse every live listing any time:');

    expect(checkTranscript(transcript, { contactCreatedAt: NOW })).toEqual([]);
  });
});

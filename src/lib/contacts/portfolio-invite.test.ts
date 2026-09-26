import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '@/types';

const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/conversations/resolve', () => ({
  resolveConversation: async () => ({ conversation: { id: 'conv-1' } }),
}));

vi.mock('@/lib/whatsapp/template-language', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/template-language')
  >()),
  resolveSendLanguage: async () => 'en',
}));

import {
  buildPortfolioInviteMessage,
  portfolioEligibilityFacts,
  portfolioInviteSides,
  portfolioInviteUrl,
  PORTFOLIO_INVITE_NOT_ELIGIBLE_ERROR,
  PORTFOLIO_INVITE_WINDOW_CLOSED_ERROR,
  sendPortfolioInvite,
} from './portfolio-invite';

interface Call {
  table: string;
  filters: Array<[string, string, unknown]>;
}

let queues: Record<string, Array<{ data: unknown }>>;
let calls: Call[];

function makeDb() {
  return {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const result = () =>
        Promise.resolve((queues[table] ?? []).shift() ?? { data: null });
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: (column: unknown, value: unknown) => {
          call.filters.push(['eq', String(column), value]);
          return builder;
        },
        neq: (column: unknown, value: unknown) => {
          call.filters.push(['neq', String(column), value]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: result,
        then: (resolve: unknown, reject: unknown) =>
          result().then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

const owner = {
  id: 'c-7',
  name: 'Lakshmi Narayan',
  phone: '+919845012345',
  classification: 'Owner',
} as Contact;

beforeEach(() => {
  queues = {};
  calls = [];
  sendWhatsAppMessageAndPersist.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.convoreal.com/');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('portfolioInviteSides', () => {
  const none = { hasBuyerActivity: false, ownsListing: false };

  it('[CTM-011] offers the sides a Portfolio sign-in would link the contact to', () => {
    expect(portfolioInviteSides('Buyer', none)).toEqual(['buyer']);
    expect(portfolioInviteSides('Owner', none)).toEqual(['owner']);
    expect(portfolioInviteSides('Seller', none)).toEqual(['owner']);
    expect(portfolioInviteSides('Owner & Buyer', none)).toEqual([
      'owner',
      'buyer',
    ]);
  });

  it('[CTM-011] counts an enquiry, rating or owner-direct listing the way sign-in linking does', () => {
    expect(
      portfolioInviteSides('Others', { ...none, hasBuyerActivity: true })
    ).toEqual(['buyer']);
    expect(portfolioInviteSides(null, { ...none, ownsListing: true })).toEqual([
      'owner',
    ]);
    expect(portfolioInviteSides('Others', none)).toEqual([]);
    expect(portfolioInviteSides('Agent', none)).toEqual([]);
  });
});

describe('portfolioEligibilityFacts', () => {
  it('[CTM-011] ignores agent-referred listings when deciding ownership', async () => {
    queues['properties'] = [{ data: [{ id: 'p-1' }] }];
    const facts = await portfolioEligibilityFacts(
      makeDb() as never,
      'acc-1',
      'c-7'
    );
    expect(facts).toEqual({ hasBuyerActivity: false, ownsListing: true });
    const listings = calls.find((call) => call.table === 'properties');
    expect(listings?.filters).toEqual([
      ['eq', 'account_id', 'acc-1'],
      ['eq', 'owner_contact_id', 'c-7'],
      ['neq', 'listing_source', 'agent'],
    ]);
  });
});

describe('portfolioInviteUrl', () => {
  it('[CTM-011] sends buyers to the buyer sign-in and owners to the owner sign-in', () => {
    expect(portfolioInviteUrl('buyer')).toBe(
      'https://www.convoreal.com/buyer/login'
    );
    expect(portfolioInviteUrl('owner')).toBe(
      'https://www.convoreal.com/den/login'
    );
  });
});

describe('buildPortfolioInviteMessage', () => {
  it('[CTM-011] tells an owner they can track their property and add listings themselves', () => {
    const message = buildPortfolioInviteMessage({
      side: 'owner',
      contactName: 'Lakshmi Narayan',
      agentName: 'Praneeth',
      brandName: 'Aryavarta Ventures',
      url: 'https://www.convoreal.com/den/login',
    });
    expect(message).toContain('Hi Lakshmi 👋');
    expect(message).toContain("I'm Praneeth from Aryavarta Ventures.");
    expect(message).toContain('*Owner Portfolio* with Aryavarta Ventures');
    expect(message).toContain('add another property yourself');
    expect(message).toContain('Sign in with this WhatsApp number');
    expect(message.endsWith('https://www.convoreal.com/den/login')).toBe(true);
  });

  it('[CTM-011] tells a buyer about matches, shortlist and requirements', () => {
    const message = buildPortfolioInviteMessage({
      side: 'buyer',
      contactName: null,
      agentName: null,
      brandName: null,
      url: 'https://www.convoreal.com/buyer/login',
    });
    expect(
      message.startsWith('Hi 👋\n\nYou now have your own *Portfolio*.')
    ).toBe(true);
    expect(message).toContain('properties matched to your requirements');
    expect(message).toContain('https://www.convoreal.com/buyer/login');
  });
});

describe('sendPortfolioInvite', () => {
  it('[CTM-011] sends free text from the business number inside the 24-hour window', async () => {
    queues['properties'] = [{ data: [] }];
    queues['messages'] = [{ data: { created_at: new Date().toISOString() } }];
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });

    const result = await sendPortfolioInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: owner,
    });
    expect(result).toMatchObject({
      success: true,
      delivery: 'free_text',
      side: 'owner',
      url: 'https://www.convoreal.com/den/login',
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        conversationId: 'conv-1',
        text: result.message,
      })
    );
  });

  it('[CTM-011] falls back to the approved Portfolio access template once the window is closed', async () => {
    queues['messages'] = [{ data: { created_at: '2020-01-01T00:00:00.000Z' } }];
    queues['message_templates'] = [
      {
        data: [
          {
            name: 'portfolio_access_notice',
            language: 'en_US',
            status: 'APPROVED',
            body_text: 'Hi {{1}}, this is an account notice from {{2}}.',
          },
        ],
      },
    ];
    queues['accounts'] = [
      { data: { name: 'Aryavarta Ventures' } },
      { data: { name: 'Aryavarta Ventures' } },
    ];
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });

    const result = await sendPortfolioInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: owner,
    });
    expect(result).toMatchObject({
      success: true,
      delivery: 'template',
      side: 'owner',
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'template',
        templateName: 'portfolio_access_notice',
        templateLanguage: 'en_US',
        templateParams: ['Lakshmi', 'Aryavarta Ventures'],
        messageParams: {
          body: ['Lakshmi', 'Aryavarta Ventures'],
          buttonParams: { 0: 'den/login' },
        },
        text: 'Hi Lakshmi, this is an account notice from Aryavarta Ventures.',
      })
    );
  });

  it('[CTM-011] refuses the business number once the window is closed and the template is not approved', async () => {
    queues['messages'] = [{ data: { created_at: '2020-01-01T00:00:00.000Z' } }];
    queues['message_templates'] = [
      {
        data: [
          {
            name: 'portfolio_access_notice',
            language: 'en_US',
            status: 'PENDING',
          },
        ],
      },
    ];

    const result = await sendPortfolioInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: owner,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(PORTFOLIO_INVITE_WINDOW_CLOSED_ERROR);
    expect(result.message).toContain('Owner Portfolio');
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });

  it('[CTM-011] sends nothing to a contact Portfolio would not link', async () => {
    const result = await sendPortfolioInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: { ...owner, classification: 'Others' } as Contact,
    });
    expect(result).toMatchObject({
      success: false,
      side: null,
      error: PORTFOLIO_INVITE_NOT_ELIGIBLE_ERROR,
    });
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});

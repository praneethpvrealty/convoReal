import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '@/types';

const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/conversations/resolve', () => ({
  resolveConversation: async () => ({ conversation: { id: 'conv-1' } }),
}));

let sendLanguage = 'en';

vi.mock('@/lib/whatsapp/template-language', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/whatsapp/template-language')
  >()),
  resolveSendLanguage: async () => sendLanguage,
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseBase: async () => 'https://www.convoreal.com/?ref=acc-1',
  accountBrandName: async () => 'Aryavarta Ventures',
}));

import {
  PORTAL_INVITE_WINDOW_CLOSED_ERROR,
  sendPortalInvite,
} from './portal-invite';

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
        in: (column: unknown, value: unknown) => {
          call.filters.push(['in', String(column), value]);
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

const buyer = {
  id: 'c-9',
  name: 'Pramod Shivanna',
  phone: '+919480611236',
  areas_of_interest: ['BTM 2nd Stage'],
  property_interests: ['Vacant plot'],
  pref_listing_types: ['Sale'],
} as Contact;

const coBroker = {
  id: 'c-4',
  name: 'Nataraj Kumar',
  phone: '+919886944961',
  classification: 'Agent',
} as Contact;

const closedWindow = { data: { created_at: '2020-01-01T00:00:00.000Z' } };

const portalTemplate = {
  name: 'property_portal_invite',
  language: 'en_US',
  status: 'APPROVED',
  body_text: 'Hi {{1}} 👋, this is {{2}}.\n\n{{3}}',
  buttons: [
    {
      type: 'URL',
      text: 'Open the portal',
      url: 'https://www.convoreal.com/{{1}}',
    },
  ],
};

const digestTemplate = {
  name: 'property_selection_update',
  language: 'en_US',
  status: 'APPROVED',
  body_text:
    "Hi {{1}}! I've selected these properties based on what you're looking for:\n\n{{2}}",
  buttons: [
    { type: 'QUICK_REPLY', text: 'Send full list' },
    { type: 'QUICK_REPLY', text: 'Book a site visit' },
    {
      type: 'URL',
      text: 'Browse showcase',
      url: 'https://www.convoreal.com/{{1}}',
    },
  ],
};

beforeEach(() => {
  queues = {};
  calls = [];
  sendLanguage = 'en';
  sendWhatsAppMessageAndPersist.mockReset();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
});

describe('sendPortalInvite outside the 24-hour window', () => {
  it('[CTM-002] sends the approved portal invite template with the filtered, attributed link in its button', async () => {
    queues['messages'] = [closedWindow];
    queues['profiles'] = [{ data: { full_name: 'Lakshmi' } }];
    queues['message_templates'] = [{ data: [portalTemplate, digestTemplate] }];

    const result = await sendPortalInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: buyer,
    });

    expect(result).toMatchObject({
      success: true,
      delivery: 'template',
      templateName: 'property_portal_invite',
    });
    const templateCall = calls.find((c) => c.table === 'message_templates');
    expect(templateCall?.filters).toContainEqual([
      'in',
      'name',
      ['property_portal_invite', 'property_selection_update'],
    ]);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'template',
        templateName: 'property_portal_invite',
        templateParams: [
          'Pramod',
          'Lakshmi from Aryavarta Ventures',
          'It already opens on vacant plot for sale in BTM 2nd Stage for you — change the filters any time to widen the search.',
        ],
        messageParams: expect.objectContaining({
          buttonParams: {
            0: '?ref=acc-1&listing_type=Sale&category=Vacant+plot&search=BTM+2nd+Stage&v=c-9',
          },
        }),
        text: expect.stringContaining(
          'Hi Pramod 👋, this is Lakshmi from Aryavarta Ventures.'
        ),
      })
    );
    expect(calls.some((c) => c.table === 'properties')).toBe(false);
  });

  it('[CTM-002] sends a co-broker the agent-view template', async () => {
    queues['messages'] = [closedWindow];
    queues['profiles'] = [{ data: { full_name: 'Lakshmi' } }];
    queues['message_templates'] = [
      {
        data: [
          { ...portalTemplate, name: 'property_portal_agent_invite' },
          digestTemplate,
        ],
      },
    ];

    const result = await sendPortalInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: coBroker,
    });

    expect(result.templateName).toBe('property_portal_agent_invite');
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'property_portal_agent_invite',
        templateParams: [
          'Nataraj',
          'Lakshmi from Aryavarta Ventures',
          'Every listing is there — filter it down for each client.',
        ],
        messageParams: expect.objectContaining({
          buttonParams: { 0: '?ref=acc-1&mode=view&v=c-4' },
        }),
      })
    );
  });

  it('[CTM-002] falls back to the inventory digest template with a pointer at the portal button, never the listing dump', async () => {
    queues['messages'] = [closedWindow];
    queues['profiles'] = [{ data: { full_name: 'Lakshmi' } }];
    queues['message_templates'] = [
      { data: [{ ...portalTemplate, status: 'PENDING' }, digestTemplate] },
    ];
    queues['properties'] = [
      {
        data: [
          { type: 'Flat/ Apartment' },
          { type: 'Commercial Office Space' },
          { type: 'Agricultural Land' },
        ],
      },
    ];

    const result = await sendPortalInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: buyer,
    });

    expect(result).toMatchObject({
      success: true,
      delivery: 'template',
      templateName: 'property_selection_update',
    });
    const [args] = sendWhatsAppMessageAndPersist.mock.calls[0] as [
      { templateParams: string[]; messageParams: { buttonParams: unknown } },
    ];
    expect(args.templateParams[0]).toBe('Pramod');
    expect(args.templateParams[1]).toContain(
      'Vacant plot for sale in BTM 2nd Stage and more across 3 listings on our portal.'
    );
    expect(args.templateParams[1]).toContain('Tap Browse showcase below');
    expect(args.templateParams[1]).not.toMatch(/₹|ROI|\+\d+ more/);
    expect(args.messageParams.buttonParams).toEqual({
      2: '?ref=acc-1&listing_type=Sale&category=Vacant+plot&search=BTM+2nd+Stage&v=c-9',
    });
  });

  it('[CTM-002] fills the parameters in the language of the variant that is actually sent', async () => {
    sendLanguage = 'hi';
    queues['messages'] = [closedWindow];
    queues['profiles'] = [{ data: { full_name: 'Lakshmi' } }];
    queues['message_templates'] = [
      {
        data: [
          {
            ...portalTemplate,
            language: 'hi',
            body_text: 'नमस्ते {{1}} 👋, यह {{2}} की ओर से संदेश है। {{3}}',
          },
          digestTemplate,
        ],
      },
    ];

    await sendPortalInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: buyer,
    });
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        templateLanguage: 'hi',
        templateParams: [
          'Pramod',
          'Aryavarta Ventures से Lakshmi',
          'यह आपके लिए पहले से vacant plot for sale in BTM 2nd Stage पर खुलता है — खोज बढ़ाने के लिए फ़िल्टर कभी भी बदलें।',
        ],
      })
    );

    sendWhatsAppMessageAndPersist.mockClear();
    queues['messages'] = [closedWindow];
    queues['profiles'] = [{ data: { full_name: 'Lakshmi' } }];
    queues['message_templates'] = [{ data: [digestTemplate] }];
    queues['properties'] = [{ data: [{ type: 'Flat/ Apartment' }] }];

    await sendPortalInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: buyer,
    });
    const [args] = sendWhatsAppMessageAndPersist.mock.calls[0] as [
      { templateLanguage: string; templateParams: string[] },
    ];
    expect(args.templateLanguage).toBe('en_US');
    expect(args.templateParams[1]).toContain('Tap Browse showcase below');
    expect(args.templateParams[1]).not.toContain('कैटलॉग देखें');
  });

  it('[CTM-002] refuses the business number when neither template is approved', async () => {
    queues['messages'] = [closedWindow];
    queues['profiles'] = [{ data: { full_name: 'Lakshmi' } }];
    queues['message_templates'] = [
      { data: [{ ...portalTemplate, status: 'REJECTED' }] },
    ];

    const result = await sendPortalInvite({
      db: makeDb() as never,
      accountId: 'acc-1',
      userId: 'user-1',
      contact: buyer,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(PORTAL_INVITE_WINDOW_CLOSED_ERROR);
    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
  });
});

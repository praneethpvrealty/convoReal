import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const rankPropertiesForContact = vi.fn();
const generateMatchEventForContact = vi.fn();
const logListingsSent = vi.fn();
const sendListingFeedbackPrompt = vi.fn();
const resolveAssignedAgent = vi.fn();
const createNotification = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));
vi.mock('@/lib/radar/engine', () => ({
  rankPropertiesForContact: (...args: unknown[]) =>
    rankPropertiesForContact(...args),
  generateMatchEventForContact: (...args: unknown[]) =>
    generateMatchEventForContact(...args),
}));
vi.mock('@/lib/whatsapp/share-property-send', () => ({
  logListingsSent: (...args: unknown[]) => logListingsSent(...args),
}));
vi.mock('@/lib/whatsapp/listing-feedback', () => ({
  sendListingFeedbackPrompt: (...args: unknown[]) =>
    sendListingFeedbackPrompt(...args),
}));
vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountShowcaseOrigin: async () => 'https://x',
  accountShowcaseBrowseUrl: async () => 'https://x/?v=c1',
}));
vi.mock('@/lib/voice/assigned-agent', () => ({
  resolveAssignedAgent: (...args: unknown[]) => resolveAssignedAgent(...args),
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

const {
  buildPreferenceNextStepsSections,
  buildWidenReply,
  buildCallbackAck,
  handlePreferenceNextStepReply,
  listingNoun,
  parsePreferenceNextStepId,
  sendPreferenceNextStepsPrompt,
  NEXT_STEPS_BODY,
} = await import('./preference-next-steps');

/**
 * [CNV-013] The menu that ends a no-match "Update my preferences"
 * reply. Before it, the lead got one typed question and a second bubble
 * repeating the form they had just declined.
 */

const PLOT_ID = '8c08d00c-6e6a-4f89-bcf5-b21bbc78ebee';
const PLOT = {
  id: PLOT_ID,
  title: '3933 Sq.Ft. North East corner Residential Plot in Surya City Phase 3',
  type: 'Residential Land/ Plot',
  city: 'Bangalore',
  user_id: 'u-lister',
};

function fakeDb(rows: Record<string, Record<string, unknown> | null>) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: rows[table] ?? null }),
          }),
        }),
      }),
      insert: async (values: Record<string, unknown>) => {
        (inserted[table] ??= []).push(values);
        return { error: null };
      },
    }),
  };
  return { db: db as never, inserted };
}

const base = (db: never) => ({
  db,
  accountId: 'acc-1',
  configOwnerUserId: 'u-owner',
  contact: { id: 'c1', name: 'Appa', phone: '919900000000' },
  conversationId: 'conv-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  rankPropertiesForContact.mockResolvedValue([]);
  generateMatchEventForContact.mockResolvedValue(undefined);
  sendListingFeedbackPrompt.mockResolvedValue(true);
  resolveAssignedAgent.mockResolvedValue({ name: 'Praneeth Kumar' });
  createNotification.mockResolvedValue({});
});

describe('listingNoun', () => {
  it.each([
    ['Residential Land/ Plot', 'plot'],
    ['Residential Plot', 'plot'],
    ['Flat/ Apartment', 'apartment'],
    ['Villa', 'villa'],
    ['Residential House', 'house'],
    ['Commercial Office Space', 'commercial space'],
    ['Commercial Land', 'commercial plot'],
    ['Farm House', 'farm house'],
    ['Agricultural Land', 'land parcel'],
    [null, 'property'],
    ['Others', 'property'],
  ])('names %s as "%s"', (type, noun) => {
    expect(listingNoun(type)).toBe(noun);
  });
});

describe('buildPreferenceNextStepsSections', () => {
  it('[CNV-013] offers the six moves, each within the list row limits, wired to the handlers that own them', () => {
    const [{ rows }] = buildPreferenceNextStepsSections({
      listing: PLOT,
      includeFormRow: true,
    });
    expect(rows.map((r) => [r.id, r.title])).toEqual([
      ['tw_budget', 'Stretch my budget'],
      [`ns_widen_${PLOT_ID}`, 'Elsewhere in Bangalore'],
      ['tw_area', 'A different area'],
      ['tw_type', 'A different type'],
      [`ns_callback_${PLOT_ID}`, 'Call me back'],
      ['lfb_form', 'Update the full form'],
    ]);
    expect(rows[0].description).toBe('Plots nearby at a higher price');
    expect(rows[1].description).toBe('The nearest plots like it, any area');
    for (const row of rows) {
      expect(row.title.length).toBeLessThanOrEqual(24);
      expect((row.description ?? '').length).toBeLessThanOrEqual(72);
    }
  });

  it('still offers every move with no listing to anchor on, and keeps a long city name off the row', () => {
    const [{ rows }] = buildPreferenceNextStepsSections({ listing: null });
    expect(rows.map((r) => r.id)).toEqual([
      'tw_budget',
      'ns_widen_any',
      'tw_area',
      'tw_type',
      'ns_callback_any',
    ]);
    expect(rows[1].title).toBe('Elsewhere in the city');
    expect(rows[1].description).toBe(
      'The nearest properties like it, any area'
    );
    const [{ rows: longCity }] = buildPreferenceNextStepsSections({
      listing: { ...PLOT, city: 'Thiruvananthapuram District' },
    });
    expect(longCity[1].title).toBe('Elsewhere in the city');
  });
});

describe('sendPreferenceNextStepsPrompt', () => {
  it('sends one interactive list and reports whether it went', async () => {
    const { db } = fakeDb({});
    expect(
      await sendPreferenceNextStepsPrompt({
        db,
        accountId: 'acc-1',
        userId: 'u-owner',
        contactId: 'c1',
        conversationId: 'conv-1',
        listing: PLOT,
        includeFormRow: true,
      })
    ).toBe(true);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'interactive',
        interactiveType: 'list',
        interactiveBody: NEXT_STEPS_BODY,
        senderType: 'bot',
      })
    );
    sendWhatsAppMessageAndPersist.mockRejectedValueOnce(new Error('down'));
    expect(
      await sendPreferenceNextStepsPrompt({
        db,
        accountId: 'acc-1',
        userId: 'u-owner',
        contactId: 'c1',
        conversationId: 'conv-1',
        listing: null,
      })
    ).toBe(false);
  });
});

describe('parsePreferenceNextStepId', () => {
  it('accepts its own ids with a UUID or the no-listing marker, nothing else', () => {
    expect(parsePreferenceNextStepId(`ns_widen_${PLOT_ID}`)).toEqual({
      step: 'widen',
      propertyId: PLOT_ID,
    });
    expect(parsePreferenceNextStepId('ns_callback_any')).toEqual({
      step: 'callback',
      propertyId: null,
    });
    expect(parsePreferenceNextStepId('ns_widen_../etc')).toBeNull();
    expect(parsePreferenceNextStepId('tw_budget')).toBeNull();
  });
});

describe('handlePreferenceNextStepReply: elsewhere in the city', () => {
  const match = {
    property: {
      id: 'p-hsr',
      title: '60x40 East Facing Residential Plot',
      property_code: 'PROP-1',
      sublocality: 'HSR Layout',
      city: 'Bangalore',
      price: 88800000,
      land_area: 2400,
      land_area_unit: 'Sq.Ft.',
    },
    score: 70,
    details: {},
  };

  it('[CNV-013] ranks with the areas on file ignored, sends the fits and the feedback list, and logs the shares', async () => {
    rankPropertiesForContact.mockResolvedValue([match]);
    const { db } = fakeDb({ properties: PLOT });

    expect(
      await handlePreferenceNextStepReply({
        ...base(db),
        replyId: `ns_widen_${PLOT_ID}`,
      })
    ).toBe(true);

    expect(rankPropertiesForContact).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'c1',
      { anyLocation: true, excludeAlreadySent: true }
    );
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain(
      "Here's the closest fit from elsewhere in our inventory:"
    );
    expect(text).toContain('60x40 East Facing Residential Plot');
    expect(text).toContain(
      'Browse every live listing any time: https://x/?v=c1'
    );
    expect(logListingsSent).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'u-owner',
      'c1',
      ['p-hsr']
    );
    expect(sendListingFeedbackPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ matches: [match], includeFormRow: true })
    );
    expect(generateMatchEventForContact).toHaveBeenCalled();
  });

  it('says so with the showcase link when nothing like it is live anywhere, naming the kind of property', async () => {
    const { db } = fakeDb({ properties: PLOT });
    await handlePreferenceNextStepReply({
      ...base(db),
      replyId: `ns_widen_${PLOT_ID}`,
    });
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain(
      'Nothing like it is live anywhere in our inventory right now'
    );
    expect(text).toContain("plots that don't fit");
    expect(text).toContain('https://x/?v=c1');
    expect(sendListingFeedbackPrompt).not.toHaveBeenCalled();
    expect(logListingsSent).not.toHaveBeenCalled();
  });

  it('works without a listing to anchor on', async () => {
    const { db } = fakeDb({});
    await handlePreferenceNextStepReply({
      ...base(db),
      replyId: 'ns_widen_any',
    });
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain("properties that don't fit");
  });
});

describe('handlePreferenceNextStepReply: call me back', () => {
  it('[CNV-013] acknowledges with the agent, files a to-do for them and alerts them', async () => {
    const { db, inserted } = fakeDb({
      properties: PLOT,
      contacts: { assigned_agent_id: 'u-agent', phone: '+919900000000' },
    });

    expect(
      await handlePreferenceNextStepReply({
        ...base(db),
        replyId: `ns_callback_${PLOT_ID}`,
      })
    ).toBe(true);

    expect(resolveAssignedAgent).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'u-agent'
    );
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toBe(
      "Thanks Appa! Praneeth will call you back shortly about *3933 Sq.Ft. North East corner Residential Plot in Surya City Phase 3*. If there's a better time to reach you, just reply here."
    );
    expect(inserted.todos).toEqual([
      expect.objectContaining({
        account_id: 'acc-1',
        assigned_to: 'u-agent',
        contact_id: 'c1',
        priority: 'high',
        source: 'system',
        title:
          'Call back Appa about 3933 Sq.Ft. North East corner Residential Plot in Surya City Phase 3',
      }),
    ]);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        userId: 'u-agent',
        type: 'listing_interest',
        eventKey: 'showcase_viewer_response',
        title: 'Call back Appa',
        body: expect.stringContaining('+919900000000'),
        link: '/inbox?conversation=conv-1',
      })
    );
  });

  it('falls back to the listing manager, then the owner, and says when the confirmation did not go through', async () => {
    const { db, inserted } = fakeDb({ properties: PLOT });
    resolveAssignedAgent.mockResolvedValue(null);
    sendWhatsAppMessageAndPersist.mockResolvedValue({
      success: false,
      error: 'window closed',
    });

    await handlePreferenceNextStepReply({
      ...base(db),
      replyId: `ns_callback_${PLOT_ID}`,
    });

    expect(inserted.todos[0].assigned_to).toBe('u-lister');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-lister',
        body: expect.stringContaining("didn't go through"),
      })
    );
    const { text } = sendWhatsAppMessageAndPersist.mock.calls[0][0] as {
      text: string;
    };
    expect(text).toContain('Our team will call you back shortly');

    vi.clearAllMocks();
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
    const noListing = fakeDb({});
    await handlePreferenceNextStepReply({
      ...base(noListing.db),
      replyId: 'ns_callback_any',
    });
    expect(noListing.inserted.todos[0]).toEqual(
      expect.objectContaining({
        assigned_to: 'u-owner',
        title: 'Call back Appa',
      })
    );
    expect(
      (sendWhatsAppMessageAndPersist.mock.calls[0][0] as { text: string }).text
    ).toContain('about your search');
  });

  it('keeps the tap when handling throws, so no other handler guesses at it', async () => {
    const db = {
      from: () => {
        throw new Error('db down');
      },
    } as never;
    expect(
      await handlePreferenceNextStepReply({
        ...base(db),
        replyId: `ns_callback_${PLOT_ID}`,
      })
    ).toBe(true);
    expect(
      await handlePreferenceNextStepReply({ ...base(db), replyId: 'x' })
    ).toBe(false);
  });
});

describe('pure text', () => {
  it('buildWidenReply and buildCallbackAck read as one person writing', () => {
    expect(
      buildWidenReply({
        listings: ['*A*', '*B*'],
        noun: 'plot',
        showcaseUrl: null,
      })
    ).toBe(
      "Here's the 2 closest fits from elsewhere in our inventory:\n\n*A*\n\n*B*\n\nWant photos or a site visit for any of these? Reply with the number and I'll set it up."
    );
    expect(
      buildCallbackAck({
        firstName: 'there',
        agentName: null,
        propertyTitle: null,
      })
    ).toBe(
      "Thanks there! Our team will call you back shortly about your search. If there's a better time to reach you, just reply here."
    );
  });
});

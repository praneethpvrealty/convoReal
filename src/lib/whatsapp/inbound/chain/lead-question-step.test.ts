import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/lead-question', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/lead-question')>()),
  answerLeadQuestion: vi.fn(),
  questionSubjectProperties: vi.fn(),
  subjectPortalListings: vi.fn(),
}));
vi.mock('@/lib/ai/bot-instructions', () => ({
  retrieveBotInstructions: vi.fn(),
  markBotInstructionsFired: vi.fn(),
}));
vi.mock('@/lib/ai/photo-request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/photo-request')>()),
  requestsPropertyPhotos: vi.fn(() => false),
  sendSubjectPhotos: vi.fn(),
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(),
}));
vi.mock('@/lib/whatsapp/reply-bridge', () => ({
  relayLeadMessageToBridgedAgent: vi.fn(),
}));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(),
}));
vi.mock('@/lib/whatsapp/listing-link-reply', () => ({
  withListingLink: vi.fn(async ({ text }: { text: string }) => text),
}));

import {
  contactNumberHandoverText,
  answerLeadQuestion,
  HANDOVER_TEXT,
  questionSubjectProperties,
  subjectPortalListings,
} from '@/lib/ai/lead-question';
import { retrieveBotInstructions } from '@/lib/ai/bot-instructions';
import { createNotification } from '@/lib/notifications/create';
import { relayLeadMessageToBridgedAgent } from '@/lib/whatsapp/reply-bridge';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { withListingLink } from '@/lib/whatsapp/listing-link-reply';
import type { InboundChainContext } from './context';
import { photoHandoverText } from '@/lib/ai/photo-request';
import { leadQuestion, withoutHandovers } from './steps/lead-question';

const conversationUpdates: unknown[] = [];
let teamReplies: { sender_type: string; content_text: string }[] = [];
let showcasePhone: string | null = null;

function fakeAdmin() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'neq', 'gte', 'order']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: null }));
  chain.limit = vi.fn(async () => ({ data: teamReplies, error: null }));
  chain.update = vi.fn((row: unknown) => {
    conversationUpdates.push(row);
    return chain;
  });
  return {
    from: vi.fn((table: string) =>
      table === 'showcase_settings'
        ? {
            ...chain,
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { contact_phone: showcasePhone },
                }),
              }),
            }),
          }
        : chain
    ),
  };
}

function ctx(overrides: Partial<InboundChainContext> = {}) {
  return {
    accountId: 'acc-1',
    message: { id: 'wamid.1', type: 'text', text: { body: '' } },
    configOwnerUserId: 'owner-1',
    senderPhone: '919900000000',
    ownerCheck: { isOwner: false },
    contactRecord: { id: 'contact-1', name: 'Ramanathan' },
    conversation: { id: 'conv-1' },
    assignedAgentUserId: 'agent-1',
    buyerRequirementMessage: false,
    isPropertyOwnerSender: false,
    inboundText: 'Do they have ekhata?',
    tappedHumanRequest: null,
    flowConsumed: false,
    agentHandling: false,
    ...overrides,
  } as unknown as InboundChainContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  conversationUpdates.length = 0;
  teamReplies = [];
  showcasePhone = null;
  vi.mocked(supabaseAdmin).mockReturnValue(
    fakeAdmin() as unknown as ReturnType<typeof supabaseAdmin>
  );
  vi.mocked(questionSubjectProperties).mockResolvedValue([
    { id: 'prop-493', title: 'Plot #493' },
  ] as unknown as Awaited<ReturnType<typeof questionSubjectProperties>>);
  vi.mocked(subjectPortalListings).mockResolvedValue([]);
  vi.mocked(retrieveBotInstructions).mockResolvedValue([]);
  vi.mocked(withListingLink).mockImplementation(async ({ text }) => text);
});

describe('[INB-038] an attribute-only message reaches the listing Q&A', () => {
  it('answers "Location road width" from the listing instead of leaving it to the ladder', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: "It's located in JP Nagar 4th Phase.",
      source: 'listing',
      intent: 'location',
    });

    await expect(
      leadQuestion(ctx({ inboundText: 'Location road width' }))
    ).resolves.toBe('handled');

    expect(answerLeadQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ question: 'Location road width' })
    );
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: "It's located in JP Nagar 4th Phase." })
    );
  });
});

describe('[INB-037] a reply about one listing carries its link', () => {
  it('sends the answer with the listing link the helper attached', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: 'This is a Commercial Building listed for sale.',
      source: 'listing',
      intent: 'type',
    });
    vi.mocked(withListingLink).mockImplementation(
      async ({ text }) =>
        `${text}\n\nFull details: https://x.test/?property_id=p`
    );

    await leadQuestion(ctx({ inboundText: 'What is the plot measurement?' }));

    expect(withListingLink).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        property: expect.objectContaining({ id: 'prop-493' }),
        text: 'This is a Commercial Building listed for sale.',
      })
    );
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: 'bot',
        text: 'This is a Commercial Building listed for sale.\n\nFull details: https://x.test/?property_id=p',
      })
    );
  });

  it('also links the listing under a handover, so the buyer can read on while they wait', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: HANDOVER_TEXT,
      source: 'handover',
    });

    await leadQuestion(ctx());

    expect(withListingLink).toHaveBeenCalledWith(
      expect.objectContaining({ text: HANDOVER_TEXT })
    );
  });

  it('links nothing when the question spans several listings', async () => {
    vi.mocked(questionSubjectProperties).mockResolvedValue([
      { id: 'prop-1', title: 'Koramangala plot' },
      { id: 'prop-2', title: 'JP Nagar villa' },
    ] as unknown as Awaited<ReturnType<typeof questionSubjectProperties>>);
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: 'It is East facing.',
      source: 'listing',
    });

    await leadQuestion(ctx({ inboundText: 'Facing of 1 and 2?' }));

    expect(withListingLink).not.toHaveBeenCalled();
  });

  it('links nothing on a listing that has left the market', async () => {
    vi.mocked(questionSubjectProperties).mockResolvedValue([
      { id: 'prop-493', title: 'Plot #493', status: 'Sold' },
    ] as unknown as Awaited<ReturnType<typeof questionSubjectProperties>>);
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: 'Sorry, this one has already been sold.',
      source: 'listing',
      intent: 'availability',
    });

    await leadQuestion(ctx({ inboundText: 'still available?' }));

    expect(withListingLink).not.toHaveBeenCalled();
  });
});

describe('[INB-035] the bot does not hand over on top of a live agent', () => {
  it('stays silent to the lead but still summons the agent when an agent replied within 24 hours', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: HANDOVER_TEXT,
      source: 'handover',
    });

    await expect(leadQuestion(ctx({ agentHandling: true }))).resolves.toBe(
      'handled'
    );

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'agent-1',
        entityId: 'conv-1',
        body: 'Do they have ekhata?',
      })
    );
    expect(relayLeadMessageToBridgedAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' })
    );
    expect(conversationUpdates).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('still sends a concrete answer from the listing while an agent is live', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: 'It is East facing.',
      source: 'listing',
      intent: 'facing',
    });

    await leadQuestion(ctx({ agentHandling: true, inboundText: 'Facing?' }));

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: 'bot',
        text: 'It is East facing.',
      })
    );
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('still sends a model-grounded answer while an agent is live', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: 'The plot is 2,400 sq.ft.',
      source: 'ai',
    });

    await leadQuestion(ctx({ agentHandling: true, inboundText: 'Size?' }));

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'The plot is 2,400 sq.ft.' })
    );
  });

  it('sends the handover line when no agent has replied within 24 hours', async () => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: HANDOVER_TEXT,
      source: 'handover',
    });

    await leadQuestion(ctx({ agentHandling: false }));

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ senderType: 'bot', text: HANDOVER_TEXT })
    );
    expect(createNotification).toHaveBeenCalled();
    expect(conversationUpdates).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('keeps the concrete answers of a multi-listing reply and drops only the handover part', async () => {
    vi.mocked(questionSubjectProperties).mockResolvedValue([
      { id: 'prop-1', title: 'Koramangala plot' },
      { id: 'prop-2', title: 'JP Nagar villa' },
    ] as unknown as Awaited<ReturnType<typeof questionSubjectProperties>>);
    vi.mocked(answerLeadQuestion)
      .mockResolvedValueOnce({ text: HANDOVER_TEXT, source: 'handover' })
      .mockResolvedValueOnce({
        text: 'It is East facing.',
        source: 'listing',
        intent: 'facing',
      });

    await leadQuestion(ctx({ agentHandling: true, inboundText: 'Facing?' }));

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '*JP Nagar villa*\nIt is East facing.',
      })
    );
    expect(createNotification).toHaveBeenCalled();
    expect(conversationUpdates).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });
});

describe('[INB-035] withoutHandovers', () => {
  const subjects = [
    { title: 'Plot A' },
    { title: 'Plot B' },
    { title: 'Plot C' },
  ];

  it('is null when every answer is a handover', () => {
    expect(
      withoutHandovers(
        [
          { text: HANDOVER_TEXT, source: 'handover' },
          { text: HANDOVER_TEXT, source: 'handover' },
        ],
        subjects
      )
    ).toBeNull();
  });

  it('keeps every concrete answer under its own title', () => {
    expect(
      withoutHandovers(
        [
          { text: '2,400 sq.ft.', source: 'listing' },
          { text: HANDOVER_TEXT, source: 'handover' },
          { text: '3,000 sq.ft.', source: 'ai' },
        ],
        subjects
      )
    ).toEqual(
      expect.objectContaining({
        text: '*Plot A*\n2,400 sq.ft.\n\n*Plot C*\n3,000 sq.ft.',
        source: 'listing',
      })
    );
  });

  it('names every remaining listing even when their answers read the same', () => {
    expect(
      withoutHandovers(
        [
          { text: HANDOVER_TEXT, source: 'handover' },
          { text: 'It is East facing.', source: 'listing' },
          { text: 'It is East facing.', source: 'listing' },
        ],
        subjects
      )?.text
    ).toBe('*Plot B*\nIt is East facing.\n\n*Plot C*\nIt is East facing.');
  });

  it('merges as before when nothing was withheld', () => {
    expect(
      withoutHandovers(
        [
          { text: 'It is East facing.', source: 'listing' },
          { text: 'It is East facing.', source: 'listing' },
        ],
        subjects
      )?.text
    ).toBe('It is East facing.');
  });

  it('returns a single-listing answer unchanged', () => {
    const answer = { text: '2,400 sq.ft.', source: 'listing' as const };
    expect(withoutHandovers([answer], [{ title: 'Plot A' }])).toEqual(answer);
  });
});

describe('[INB-035] the bot promises a person once', () => {
  beforeEach(() => {
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: HANDOVER_TEXT,
      source: 'handover',
    });
  });

  it('does not repeat the handover line when its last reply already promised one, but still summons the agent', async () => {
    teamReplies = [{ sender_type: 'bot', content_text: HANDOVER_TEXT }];

    await expect(leadQuestion(ctx())).resolves.toBe('handled');

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'conv-1' })
    );
    expect(relayLeadMessageToBridgedAgent).toHaveBeenCalled();
    expect(conversationUpdates).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('treats an earlier photo handover as the same promise', async () => {
    teamReplies = [
      { sender_type: 'bot', content_text: photoHandoverText('Plot #493') },
    ];

    await leadQuestion(ctx());

    expect(sendWhatsAppMessageAndPersist).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalled();
  });

  it('sends the handover line when the bot last said something else', async () => {
    teamReplies = [{ sender_type: 'bot', content_text: 'It is East facing.' }];

    await leadQuestion(ctx());

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: HANDOVER_TEXT })
    );
  });

  it('sends the handover line when nothing was said in the last 24 hours', async () => {
    await leadQuestion(ctx());

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: HANDOVER_TEXT })
    );
  });

  it('still sends a concrete answer after an earlier handover', async () => {
    teamReplies = [{ sender_type: 'bot', content_text: HANDOVER_TEXT }];
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: 'It is East facing.',
      source: 'listing',
    });

    await leadQuestion(ctx({ inboundText: 'Facing?' }));

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'It is East facing.' })
    );
  });
});

describe('[INB-011] a lead asking for our number', () => {
  it('passes the account contact number to the answer, and sends one reply for three listings', async () => {
    showcasePhone = '+91 99002 77111';
    const reply = contactNumberHandoverText(showcasePhone);
    vi.mocked(questionSubjectProperties).mockResolvedValue([
      { id: 'p1', title: 'Commercial Building in Koramangala 5th Block' },
      { id: 'p2', title: 'Rent yielding Commercial building' },
      { id: 'p3', title: 'Prime Corner Commercial Plot' },
    ] as unknown as Awaited<ReturnType<typeof questionSubjectProperties>>);
    vi.mocked(answerLeadQuestion).mockResolvedValue({
      text: reply,
      source: 'handover',
    });

    await leadQuestion(
      ctx({
        inboundText:
          'Could you share me an appropriate number to discuss over an call',
      })
    );

    expect(answerLeadQuestion).toHaveBeenCalledTimes(3);
    expect(answerLeadQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ contactPhone: '+91 99002 77111' })
    );
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ text: reply })
    );
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

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
vi.mock('@/lib/ai/photo-request', () => ({
  photoHandoverText: vi.fn(() => 'photo handover'),
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

import {
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
import type { InboundChainContext } from './context';
import { leadQuestion, withoutHandovers } from './steps/lead-question';

const conversationUpdates: unknown[] = [];

function fakeAdmin() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: null }));
  chain.update = vi.fn((row: unknown) => {
    conversationUpdates.push(row);
    return chain;
  });
  return { from: vi.fn(() => chain) };
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
  vi.mocked(supabaseAdmin).mockReturnValue(
    fakeAdmin() as unknown as ReturnType<typeof supabaseAdmin>
  );
  vi.mocked(questionSubjectProperties).mockResolvedValue([
    { id: 'prop-493', title: 'Plot #493' },
  ] as unknown as Awaited<ReturnType<typeof questionSubjectProperties>>);
  vi.mocked(subjectPortalListings).mockResolvedValue([]);
  vi.mocked(retrieveBotInstructions).mockResolvedValue([]);
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

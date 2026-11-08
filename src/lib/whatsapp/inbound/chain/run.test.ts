import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEAD_CONTACT_BLOCKED_MESSAGE } from '@/lib/contacts/lifecycle';
import { BOT_PAUSED_BLOCKED_MESSAGE } from '@/lib/conversations/bot-pause';
import { CHAIN_ONLY_BLOCKED_MESSAGE } from '@/lib/contacts/chain-only';
import type { InboundChainPayload } from './context';

const steps = vi.hoisted(() => ({
  first: vi.fn<() => Promise<'handled' | 'continue'>>(),
  second: vi.fn<() => Promise<'handled' | 'continue'>>(),
}));
vi.mock('./steps', () => ({
  INBOUND_STEPS: [
    { name: 'first', run: () => steps.first() },
    { name: 'second', run: () => steps.second() },
  ],
  STEPS_WHILE_BOT_PAUSED: new Set<string>(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/conversations/bot-pause', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/bot-pause')>()),
  isBotPaused: async () => false,
}));
vi.mock('@/lib/whatsapp/serialized-inbound', () => ({
  isEarliestCustomerMessage: async () => false,
}));
vi.mock('@/lib/ai/lead-routing', () => ({
  isBuyerRequirementMessage: () => false,
}));
vi.mock('@/lib/ai/named-share', () => ({
  detailsRequestForSharedListing: async () => false,
}));

import { handleInboundChain, isSendPolicyRefusal } from './run';

const payload = {
  message: {
    id: 'wamid.1',
    from: '919000000000',
    timestamp: '1',
    type: 'text',
  },
  configOwnerUserId: 'user-1',
  phoneNumberId: 'pn-1',
  senderPhone: '919000000000',
  contactWasCreated: false,
  contactRecord: { id: 'c-1' },
  conversation: { id: 'conv-1' },
  contentText: 'Show Properties',
  interactiveReplyId: null,
  nfmResponseJson: null,
  routingUpdate: {},
  enquiryPropertyId: null,
  enquiryIsDeliberate: false,
  enquiryPropertyTitle: null,
  specificPropertyInterest: false,
  propertyReferenceNeedsAgent: false,
  isFirstInboundMessage: false,
  ownerCheck: { isOwner: false },
} as unknown as InboundChainPayload;

const run = () =>
  handleInboundChain(payload, { waited: false }, 'acc-1', 'token');

describe('[INB-049] a dispatcher policy refusal inside a step', () => {
  beforeEach(() => {
    steps.first.mockReset();
    steps.second.mockReset();
    steps.second.mockResolvedValue('continue');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('ends the chain quietly instead of failing the webhook', async () => {
    steps.first.mockRejectedValue(new Error(DEAD_CONTACT_BLOCKED_MESSAGE));

    await expect(run()).resolves.toBeUndefined();

    expect(steps.second).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('first stood down on wamid.1')
    );
  });

  it('still fails the webhook on any other error, so the queue retries it', async () => {
    steps.first.mockRejectedValue(new Error('connection reset'));

    await expect(run()).rejects.toThrow('connection reset');
    expect(steps.second).not.toHaveBeenCalled();
  });

  it('runs the next step after an ordinary continue', async () => {
    steps.first.mockResolvedValue('continue');

    await run();

    expect(steps.second).toHaveBeenCalledTimes(1);
  });

  it('recognises each of the dispatcher refusals and nothing else', () => {
    expect(isSendPolicyRefusal(new Error(DEAD_CONTACT_BLOCKED_MESSAGE))).toBe(
      true
    );
    expect(isSendPolicyRefusal(new Error(BOT_PAUSED_BLOCKED_MESSAGE))).toBe(
      true
    );
    expect(isSendPolicyRefusal(new Error(CHAIN_ONLY_BLOCKED_MESSAGE))).toBe(
      true
    );
    expect(isSendPolicyRefusal(new Error('Meta returned 500'))).toBe(false);
  });
});

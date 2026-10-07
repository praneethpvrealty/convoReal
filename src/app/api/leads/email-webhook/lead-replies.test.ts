import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./auto-reply', () => ({
  sendAutoReply: vi.fn(),
}));
vi.mock('./unavailable-listing', () => ({
  sendUnavailableListingReply: vi.fn(),
}));

import { sendAutoReply } from './auto-reply';
import { sendUnavailableListingReply } from './unavailable-listing';
import { sendLeadArrivalReplies } from './lead-replies';

const autoReply = vi.mocked(sendAutoReply);
const notice = vi.mocked(sendUnavailableListingReply);

const args = {
  supabase: {} as SupabaseClient,
  accountId: 'acc-1',
  userId: 'user-1',
  syncConfig: null,
  contactId: 'contact-1',
  conversationId: 'conv-1',
  cleanPhone: '919999999999',
  leadName: 'Shirish',
  leadSource: '99acres',
};

/**
 * A portal lead whose listing has left the market used to receive the
 * welcome template and, two seconds later, the status notice: "tell me
 * your requirement and I'll share properties" followed by "the listing
 * is no longer available". These pin that the arrival is one message.
 */
describe('[CNV-001] sendLeadArrivalReplies', () => {
  beforeEach(() => {
    autoReply.mockReset();
    notice.mockReset();
    autoReply.mockResolvedValue({ success: true, messageId: 'm1' });
  });

  it('sends only the status notice when the enquired listing is unavailable', async () => {
    notice.mockResolvedValue('template');

    const result = await sendLeadArrivalReplies({
      ...args,
      matchedPropertyId: 'prop-20',
    });

    expect(result).toEqual({ notice: 'template', autoReply: null });
    expect(notice).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-20', contactId: 'contact-1' })
    );
    expect(autoReply).not.toHaveBeenCalled();
  });

  it('counts the free-form unavailable reply as the greeting too', async () => {
    notice.mockResolvedValue('text');
    await sendLeadArrivalReplies({ ...args, matchedPropertyId: 'prop-20' });
    expect(autoReply).not.toHaveBeenCalled();
  });

  it('welcomes a lead whose listing is live', async () => {
    notice.mockResolvedValue('available');

    const result = await sendLeadArrivalReplies({
      ...args,
      matchedPropertyId: 'prop-20',
    });

    expect(result.notice).toBe('available');
    expect(result.autoReply?.success).toBe(true);
    expect(autoReply).toHaveBeenCalledWith(
      expect.objectContaining({ forceSend: true, leadName: 'Shirish' })
    );
  });

  it('welcomes a lead that matched no listing without probing a notice', async () => {
    await sendLeadArrivalReplies({ ...args, matchedPropertyId: null });
    expect(notice).not.toHaveBeenCalled();
    expect(autoReply).toHaveBeenCalledTimes(1);
  });

  it.each(['no_template', 'failed'] as const)(
    'falls back to the welcome when the notice could not go out (%s)',
    async (outcome) => {
      notice.mockResolvedValue(outcome);
      await sendLeadArrivalReplies({ ...args, matchedPropertyId: 'prop-20' });
      expect(autoReply).toHaveBeenCalledTimes(1);
    }
  );
});

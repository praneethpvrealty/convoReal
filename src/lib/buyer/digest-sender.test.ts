import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

import { sendBuyerConsentRequest } from './digest-sender';

describe('sendBuyerConsentRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  });

  it('sends the benefits nudge with actionable Start and Stop buttons', async () => {
    const db = { from: vi.fn() } as never;

    await expect(
      sendBuyerConsentRequest(db, {
        accountId: 'account-1',
        contactId: 'contact-1',
        contactName: 'Dr K Bhagavan',
        matchCount: 1,
        agencyName: 'Aryavarta Ventures',
      })
    ).resolves.toBe(true);

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        contactId: 'contact-1',
        kind: 'interactive',
        interactiveType: 'buttons',
        interactiveBody: expect.stringContaining('urgent and below-market'),
        interactiveButtons: [
          { id: 'buyer_alerts:start', title: 'Start Alerts' },
          { id: 'buyer_alerts:stop', title: 'Stop Alerts' },
        ],
        customDbClient: db,
      })
    );
  });

  it('nudges for future alerts when there is no immediate match', async () => {
    const db = { from: vi.fn() } as never;

    await sendBuyerConsentRequest(db, {
      accountId: 'account-1',
      contactId: 'contact-1',
      contactName: 'Dr K Bhagavan',
      matchCount: 0,
      agencyName: 'Aryavarta Ventures',
    });

    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        interactiveBody: expect.stringContaining('keep watching'),
        interactiveButtons: [
          { id: 'buyer_alerts:start', title: 'Start Alerts' },
          { id: 'buyer_alerts:stop', title: 'Stop Alerts' },
        ],
      })
    );
  });
});

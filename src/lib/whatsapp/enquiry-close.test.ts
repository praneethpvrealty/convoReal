import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const resolveDroppedProperty = vi.fn();
const sendEnquiryDropoffPrompt = vi.fn();
const closePropertyEnquiry = vi.fn();
const loadOpenEnquiries = vi.fn();
const sendEnquiryReview = vi.fn();
const markContactDead = vi.fn();

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersist(...args),
}));

vi.mock('@/lib/whatsapp/enquiry-dropoff', () => ({
  resolveDroppedProperty: (...args: unknown[]) =>
    resolveDroppedProperty(...args),
  sendEnquiryDropoffPrompt: (...args: unknown[]) =>
    sendEnquiryDropoffPrompt(...args),
}));

vi.mock('@/lib/whatsapp/enquiry-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./enquiry-review')>()),
  closePropertyEnquiry: (...args: unknown[]) => closePropertyEnquiry(...args),
  loadOpenEnquiries: (...args: unknown[]) => loadOpenEnquiries(...args),
  sendEnquiryReview: (...args: unknown[]) => sendEnquiryReview(...args),
}));

vi.mock('@/lib/contacts/lifecycle', () => ({
  markContactDead: (...args: unknown[]) => markContactDead(...args),
}));

const { buildPropertyCloseAck, handleEnquiryClose } =
  await import('./enquiry-close');

/**
 * [INB-010] "Close my enquiry" closes the listing the template named,
 * not the lead. The contact stays live and matching, is told their
 * other enquiries stay open, and the tap's window runs the drop-off
 * reason. Only a close that names nothing, on a journey with nothing
 * open, is read as ending the search — and its goodbye's START ALERTS
 * revives the contact.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const villa = {
  id: P1,
  title: 'Renovated 4BHK Villa',
  property_code: 'PROP-1559',
};
const open = [
  { itemId: 'item-2', property: { id: 'p2', title: 'Office in HSR Layout' } },
];

const db = {} as never;
const args = (consent?: 'pending' | 'granted' | 'declined') => ({
  db,
  accountId: 'acct-1',
  userId: 'owner-1',
  contact: { id: 'c1', name: 'Vasudha Rao', buyer_alerts_consent: consent },
  conversationId: 'conv-1',
  contextMessageId: 'wamid.quoted',
});

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessageAndPersist.mockResolvedValue({ success: true });
  sendEnquiryDropoffPrompt.mockResolvedValue(true);
  closePropertyEnquiry.mockResolvedValue(undefined);
  sendEnquiryReview.mockResolvedValue(true);
  markContactDead.mockResolvedValue(true);
});

describe('buildPropertyCloseAck', () => {
  it('[INB-010] names the listing, says the rest stays open, and pitches alerts only when not yet granted', () => {
    const pending = buildPropertyCloseAck({
      property: villa,
      openCount: 2,
      alertsGranted: false,
    });
    expect(pending).toContain('*Renovated 4BHK Villa (PROP-1559)* is closed');
    expect(pending).toContain('your other 2 enquiries with us stay open');
    expect(pending).toContain('START ALERTS');
    expect(pending).not.toContain('last update');

    const granted = buildPropertyCloseAck({
      property: villa,
      openCount: 0,
      alertsGranted: true,
    });
    expect(granted).not.toContain('stay open');
    expect(granted).not.toContain('START ALERTS');
  });
});

describe('handleEnquiryClose', () => {
  it('[INB-010] a close on a named listing files that listing, keeps the contact live and asks why', async () => {
    resolveDroppedProperty.mockResolvedValue(villa);
    loadOpenEnquiries.mockResolvedValue(open);

    const outcome = await handleEnquiryClose(args('pending'));

    expect(outcome).toBe('property');
    expect(closePropertyEnquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contact: expect.objectContaining({ id: 'c1' }),
        property: villa,
      })
    );
    expect(markContactDead).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        allowDeadContact: true,
        text: expect.stringContaining('your other enquiry with us stays open'),
      })
    );
    expect(sendEnquiryDropoffPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', property: villa })
    );
    expect(sendEnquiryReview).not.toHaveBeenCalled();
  });

  it('[INB-010] a close naming nothing reviews the open enquiries instead of ending the search', async () => {
    resolveDroppedProperty.mockResolvedValue(null);
    loadOpenEnquiries.mockResolvedValue(open);

    const outcome = await handleEnquiryClose(args('declined'));

    expect(outcome).toBe('review');
    expect(closePropertyEnquiry).not.toHaveBeenCalled();
    expect(markContactDead).not.toHaveBeenCalled();
    expect(sendEnquiryDropoffPrompt).not.toHaveBeenCalled();
    expect(sendEnquiryReview).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        enquiries: open,
        acknowledgement: expect.stringContaining('closed'),
      })
    );
  });

  it('[INB-010] a close naming nothing with nothing open ends the search: dead, goodbye, START ALERTS', async () => {
    resolveDroppedProperty.mockResolvedValue(null);
    loadOpenEnquiries.mockResolvedValue([]);

    const outcome = await handleEnquiryClose(args('pending'));

    expect(outcome).toBe('search');
    expect(markContactDead).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', reason: 'closed_enquiry' })
    );
    const text = (
      sendWhatsAppMessageAndPersist.mock.calls[0][0] as { text: string }
    ).text;
    expect(text.indexOf('your enquiry is closed')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('listing engine')).toBeGreaterThan(
      text.indexOf('your enquiry is closed')
    );
    expect(text).toContain('START ALERTS');
    expect(text).toContain('last update');
  });

  it('never throws — the lead asked for an acknowledgement', async () => {
    resolveDroppedProperty.mockRejectedValue(new Error('db down'));
    await expect(handleEnquiryClose(args())).resolves.toBe('search');
  });
});

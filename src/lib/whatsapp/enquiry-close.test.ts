import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessageAndPersist = vi.fn();
const resolveDroppedProperty = vi.fn();
const sendEnquiryDropoffPrompt = vi.fn();
const closePropertyEnquiry = vi.fn();
const loadOpenEnquiries = vi.fn();
const sendEnquiryReview = vi.fn();
const markContactDead = vi.fn();
const continueAfterEnquiryClose = vi.fn();
const createNotification = vi.fn();

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

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
  continueAfterEnquiryClose: (...args: unknown[]) =>
    continueAfterEnquiryClose(...args),
}));

vi.mock('@/lib/contacts/lifecycle', () => ({
  markContactDead: (...args: unknown[]) => markContactDead(...args),
}));

const {
  buildPropertyCloseAck,
  buildSoldReportAck,
  handleEnquiryClose,
  handleSoldReport,
  SOLD_REPORT_REASON,
} = await import('./enquiry-close');

/**
 * [INB-010] "Close my enquiry" closes the listing the template named,
 * not the lead. The contact stays live and matching, is told their
 * other enquiries stay open, and the tap's window runs the drop-off
 * reason only for a listing that was still live: one that had left
 * the market was ended by the agency, so the lead is never asked what
 * made them drop it. Only a close that names nothing, on a journey
 * with nothing open, is read as ending the search — and its goodbye's
 * START ALERTS revives the contact.
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
  it('[INB-010] names the listing, says the rest stays open, and offers alerts in one plain line only when not yet granted', () => {
    const pending = buildPropertyCloseAck({
      property: villa,
      openCount: 2,
      alertsGranted: false,
    });
    expect(pending).toContain('*Renovated 4BHK Villa (PROP-1559)* is closed');
    expect(pending).toContain('Your other enquiries with us stay open.');
    expect(pending).toContain('START ALERTS');
    expect(pending).not.toMatch(/engine|steal|last update|other 2/);

    const granted = buildPropertyCloseAck({
      property: villa,
      openCount: 0,
      alertsGranted: true,
    });
    expect(granted).not.toContain('stay open');
    expect(granted).not.toContain('START ALERTS');
    expect(granted.split('\n').filter(Boolean)).toHaveLength(1);
  });
});

describe('handleEnquiryClose', () => {
  it('[INB-010] a close on a live listing files that listing, keeps the contact live and asks why', async () => {
    resolveDroppedProperty.mockResolvedValue({
      ...villa,
      status: 'Available',
      is_published: true,
    });
    loadOpenEnquiries.mockResolvedValue(open);

    const outcome = await handleEnquiryClose(args('pending'));

    expect(outcome).toBe('property');
    expect(closePropertyEnquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        contact: expect.objectContaining({ id: 'c1' }),
        property: expect.objectContaining({ id: P1 }),
      })
    );
    expect(markContactDead).not.toHaveBeenCalled();
    expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        allowDeadContact: true,
        text: expect.stringContaining('Your other enquiries with us stay open'),
      })
    );
    expect(sendEnquiryDropoffPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        property: expect.objectContaining({ id: P1 }),
      })
    );
    expect(sendEnquiryReview).not.toHaveBeenCalled();
  });

  it.each([
    ['off the market', { status: 'Off Market' }],
    ['under contract', { status: 'Under Contract' }],
    ['sold', { status: 'Sold' }],
    ['unpublished', { status: 'Available', is_published: false }],
  ])(
    '[INB-009] never asks why they dropped a listing that was %s: one acknowledgement and nothing after it',
    async (_label, patch) => {
      resolveDroppedProperty.mockResolvedValue({ ...villa, ...patch });
      loadOpenEnquiries.mockResolvedValue(open);

      const outcome = await handleEnquiryClose(args('granted'));

      expect(outcome).toBe('property');
      expect(closePropertyEnquiry).toHaveBeenCalledTimes(1);
      expect(sendWhatsAppMessageAndPersist).toHaveBeenCalledTimes(1);
      expect(sendEnquiryDropoffPrompt).not.toHaveBeenCalled();
      expect(sendEnquiryReview).not.toHaveBeenCalled();
      expect(markContactDead).not.toHaveBeenCalled();
    }
  );

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
    expect(text.indexOf('START ALERTS')).toBeGreaterThan(
      text.indexOf('your enquiry is closed')
    );
    expect(text).toContain('last update');
    expect(text).not.toMatch(/engine|steal/);
  });

  it('never throws — the lead asked for an acknowledgement', async () => {
    resolveDroppedProperty.mockRejectedValue(new Error('db down'));
    await expect(handleEnquiryClose(args())).resolves.toBe('search');
  });
});

describe('[JRN-023] a buyer saying the listing is sold', () => {
  const plot = {
    id: P1,
    title: '2450 Sqft South facing residential plot in Vijaya Bank Layout',
    property_code: 'PROP-1306',
    status: 'Available',
    is_published: true,
    user_id: 'lister-1',
  };

  function soldDb() {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    return {
      inserts,
      db: {
        from: (table: string) => ({
          insert: async (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return { error: null };
          },
        }),
      } as never,
    };
  }

  const soldArgs = (
    db: never,
    property: typeof plot,
    assigned: string | null = 'agent-7'
  ) => ({
    db,
    accountId: 'acct-1',
    userId: 'owner-1',
    contact: { id: 'c1', name: 'Ramanathan', assigned_agent_id: assigned },
    conversationId: 'conv-1',
    property,
    reportText: 'You said its already sold',
  });

  it('apologises, says the enquiry is closed and never shows the property code', () => {
    const live = buildSoldReportAck({
      contactName: 'Ramanathan K',
      property: plot,
    });
    expect(live).toBe(
      "Sorry for the mix-up, Ramanathan. I've closed your enquiry on *2450 Sqft South facing residential plot in Vijaya Bank Layout*, so you won't get further updates on it, and asked the team to confirm where it stands."
    );
    const sold = buildSoldReportAck({
      contactName: null,
      property: { ...plot, status: 'Sold' },
    });
    expect(sold).toBe(
      "Sorry for the mix-up. *2450 Sqft South facing residential plot in Vijaya Bank Layout* is no longer available, so I've closed your enquiry on it and you won't get further updates on it."
    );
    for (const text of [live, sold]) {
      expect(text).not.toContain('PROP-1306');
      expect(text).not.toMatch(/when should we check back/i);
    }
  });

  it('closes the enquiry, flags a still-Available listing to the assigned agent and hands over to the matches', async () => {
    const { db, inserts } = soldDb();
    await handleSoldReport(soldArgs(db, plot));

    expect(closePropertyEnquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        property: plot,
        reason: SOLD_REPORT_REASON,
      })
    );
    const todo = inserts.find((i) => i.table === 'todos')?.row;
    expect(todo).toMatchObject({
      assigned_to: 'agent-7',
      contact_id: 'c1',
      property_id: P1,
      priority: 'high',
      completed: false,
      source: 'system',
    });
    expect(String(todo?.title)).toContain('Confirm whether');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'agent-7',
        entityType: 'property',
        entityId: P1,
        title: expect.stringContaining('says'),
        link: '/inventory?propertyId=PROP-1306',
      })
    );
    expect(continueAfterEnquiryClose).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        conversationId: 'conv-1',
        acknowledgement: expect.stringContaining('Sorry for the mix-up'),
      })
    );
    expect(sendEnquiryDropoffPrompt).not.toHaveBeenCalled();
    expect(markContactDead).not.toHaveBeenCalled();
  });

  it('falls back to the listing manager when nobody is assigned', async () => {
    const { db, inserts } = soldDb();
    await handleSoldReport(soldArgs(db, plot, null));
    expect(inserts.find((i) => i.table === 'todos')?.row.assigned_to).toBe(
      'lister-1'
    );
  });

  it('flags nothing when inventory already agrees the listing is gone', async () => {
    const { db, inserts } = soldDb();
    await handleSoldReport(soldArgs(db, { ...plot, status: 'Sold' }));
    expect(inserts).toEqual([]);
    expect(createNotification).not.toHaveBeenCalled();
    expect(closePropertyEnquiry).toHaveBeenCalled();
    expect(continueAfterEnquiryClose).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgement: expect.stringContaining('no longer available'),
      })
    );
  });

  it('closes the listing the caller already resolved without looking it up again', async () => {
    loadOpenEnquiries.mockResolvedValue([]);
    await handleEnquiryClose({ ...args(), property: villa });
    expect(resolveDroppedProperty).not.toHaveBeenCalled();
    expect(closePropertyEnquiry).toHaveBeenCalledWith(
      expect.objectContaining({ property: villa })
    );
  });
});

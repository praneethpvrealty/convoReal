import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

function makeAdmin() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'accounts'
                ? { owner_user_id: 'user-owner', status: 'active' }
                : table === 'properties'
                  ? { user_id: 'user-agent' }
                  : null,
            error: null,
          }),
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => makeAdmin() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
const resolveSellerPage = vi.fn();
vi.mock('@/lib/showcase/seller-page', () => ({
  resolveSellerPage: (...args: unknown[]) => resolveSellerPage(...args),
}));
const fileInquiry = vi.fn<
  (admin: unknown, input: Row) => Promise<{ contactId: string }>
>(async () => ({ contactId: 'lead-1' }));
vi.mock('@/lib/showcase/file-inquiry', () => ({
  InquiryContactError: class extends Error {},
  fileShowcaseInquiry: (admin: unknown, input: Row) =>
    fileInquiry(admin, input),
}));
const resolveSessionReferrer = vi.fn();
const isExistingLead = vi.fn();
const openReferredEnquiry = vi.fn();
vi.mock('@/lib/showcase/referred-enquiries', () => ({
  resolveSessionReferrer: (...args: unknown[]) =>
    resolveSessionReferrer(...args),
  isExistingLead: (...args: unknown[]) => isExistingLead(...args),
  openReferredEnquiry: (...args: unknown[]) => openReferredEnquiry(...args),
}));
const notify = vi.fn<(input: Row) => Promise<object>>(async () => ({}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: (input: Row) => notify(input),
}));

const { POST } = await import('./route');

const SESSION = '9c7c5a9b-500d-4f42-9db5-846acfb385ec';
const NIMMY = {
  contactId: 'contact-nimmy',
  name: 'Nimmy',
  phone: '+918657601861',
};

function post(body: Row = {}) {
  return POST(
    new Request('http://localhost/api/public/inquiry', {
      method: 'POST',
      body: JSON.stringify({
        accountId: 'acc-1',
        name: 'manju Poojappa',
        phone: '9845077813',
        propertyId: 'prop-1',
        propertyTitle: 'Commercial Building',
        referrerContactId: 'contact-from-browser',
        sessionKey: SESSION,
        ...body,
      }),
    })
  );
}

beforeEach(() => {
  fileInquiry.mockClear();
  notify.mockClear();
  resolveSellerPage.mockReset();
  resolveSessionReferrer.mockReset();
  isExistingLead.mockReset().mockResolvedValue(false);
  openReferredEnquiry.mockReset().mockResolvedValue('pending');
});

describe('[PLS-010] POST /api/public/inquiry holds an agent’s guest', () => {
  it('files nothing for a guest of an agent’s forwarded link and returns no contact', async () => {
    resolveSessionReferrer.mockResolvedValue({ ...NIMMY, isAgent: true });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, pendingReferral: true });
    expect(fileInquiry).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(openReferredEnquiry.mock.calls[0][1]).toMatchObject({
      source: 'website',
      requesterName: 'manju Poojappa',
      sessionKey: SESSION,
      payload: { referrerContactId: 'contact-nimmy', propertyId: 'prop-1' },
    });
  });

  it('tells the form when the agent already declined this guest, and files nothing', async () => {
    resolveSessionReferrer.mockResolvedValue({ ...NIMMY, isAgent: true });
    openReferredEnquiry.mockResolvedValue('closed');
    const res = await post();
    expect(await res.json()).toEqual({ success: true, referralClosed: true });
    expect(fileInquiry).not.toHaveBeenCalled();
  });

  it('files the enquiry with the agent credited when the agent cannot be asked', async () => {
    resolveSessionReferrer.mockResolvedValue({ ...NIMMY, isAgent: true });
    openReferredEnquiry.mockResolvedValue('undeliverable');
    const res = await post();
    expect(await res.json()).toEqual({ success: true, contactId: 'lead-1' });
    expect(fileInquiry.mock.calls[0][1]).toMatchObject({
      referrerContactId: 'contact-nimmy',
    });
  });

  it('credits a buyer or owner who forwarded the link and tells the listing side, with no approval step', async () => {
    resolveSessionReferrer.mockResolvedValue({ ...NIMMY, isAgent: false });
    const res = await post();
    expect(await res.json()).toEqual({ success: true, contactId: 'lead-1' });
    expect(openReferredEnquiry).not.toHaveBeenCalled();
    expect(fileInquiry.mock.calls[0][1]).toMatchObject({
      referrerContactId: 'contact-nimmy',
    });
    expect(notify.mock.calls[0][0]).toMatchObject({
      title: "Nimmy's guest enquired",
      eventKey: 'referred_enquiry',
      userId: 'user-agent',
      entityId: 'lead-1',
    });
  });

  it('never holds a visitor who is already a lead of the account', async () => {
    resolveSessionReferrer.mockResolvedValue({ ...NIMMY, isAgent: true });
    isExistingLead.mockResolvedValue(true);
    const res = await post();
    expect(await res.json()).toEqual({ success: true, contactId: 'lead-1' });
    expect(openReferredEnquiry).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(fileInquiry.mock.calls[0][1]).toMatchObject({
      referrerContactId: 'contact-from-browser',
    });
  });

  it('files a direct visitor’s enquiry exactly as before', async () => {
    resolveSessionReferrer.mockResolvedValue(null);
    const res = await post();
    expect(await res.json()).toEqual({ success: true, contactId: 'lead-1' });
    expect(isExistingLead).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('leaves a seller page’s enquiry with the seller as referrer', async () => {
    resolveSellerPage.mockResolvedValue({ contactId: 'contact-seller' });
    const res = await post({ sellerPage: 'some-seller' });
    expect(await res.json()).toEqual({ success: true, contactId: 'lead-1' });
    expect(resolveSessionReferrer).not.toHaveBeenCalled();
    expect(fileInquiry.mock.calls[0][1]).toMatchObject({
      referrerContactId: 'contact-seller',
    });
  });
});

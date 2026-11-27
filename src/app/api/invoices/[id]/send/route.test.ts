import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  adminContact: { do_not_contact: true } as Record<string, unknown> | null,
  adminFilters: {} as Record<string, unknown>,
  addressRows: [] as Record<string, unknown>[],
  invoiceContactId: 'c-hidden' as string | null,
  rendered: 0,
  sent: 0,
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: {
      from: (table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () =>
            table === 'invoices'
              ? {
                  data: {
                    id: 'inv-1',
                    status: 'issued',
                    contact_id: state.invoiceContactId,
                    bill_to: { phone: '+919000000000', email: 'a@b.c' },
                  },
                  error: null,
                }
              : { data: null, error: null },
        };
        return builder;
      },
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        state.adminFilters[column] = value;
        return builder;
      },
      like: () => builder,
      ilike: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: state.adminContact, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: state.addressRows, error: null }).then(resolve),
    };
    return { from: () => builder };
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: {} },
}));

vi.mock('@/lib/invoices/server', () => ({
  canTransition: () => true,
  INVOICE_BUCKET: 'invoices',
  logInvoiceEvent: async () => {},
  renderInvoice: async () => {
    state.rendered += 1;
    return { pdf: new Uint8Array(), hash: 'h' };
  },
  signedUrlFor: async () => 'https://example.test/inv.pdf',
  storeInvoicePdf: async () => 'path',
}));

vi.mock('@/lib/email', () => ({
  sendTransactionalEmail: async () => {
    state.sent += 1;
    return { success: true };
  },
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendMediaMessage: async () => {
    state.sent += 1;
  },
}));

import { POST } from './route';

function send(channel: 'email' | 'whatsapp') {
  return POST(
    new Request('http://localhost/api/invoices/inv-1/send', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    }),
    { params: Promise.resolve({ id: 'inv-1' }) }
  );
}

describe('[CTM-021] invoice delivery to a do-not-contact customer', () => {
  beforeEach(() => {
    state.adminContact = { do_not_contact: true };
    state.adminFilters = {};
    state.addressRows = [];
    state.invoiceContactId = 'c-hidden';
    state.rendered = 0;
    state.sent = 0;
  });

  it('refuses even when the agent cannot see the contact', async () => {
    const res = await send('email');

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'DO_NOT_CONTACT' });
    expect(state.adminFilters).toMatchObject({
      account_id: 'acc-1',
      id: 'c-hidden',
    });
    expect(state.rendered).toBe(0);
    expect(state.sent).toBe(0);
  });

  it('refuses on WhatsApp too', async () => {
    const res = await send('whatsapp');
    expect(res.status).toBe(409);
    expect(state.sent).toBe(0);
  });

  it('refuses rather than sends when the contact cannot be read', async () => {
    state.adminContact = null;
    const res = await send('email');
    expect(res.status).toBe(503);
    expect(state.sent).toBe(0);
  });

  it('refuses an invoice with no linked contact going to a blocked number', async () => {
    state.invoiceContactId = null;
    state.addressRows = [{ phone: '+919000000000' }];
    const res = await send('whatsapp');
    expect(res.status).toBe(409);
    expect(state.sent).toBe(0);
  });

  it('refuses an email to a blocked address even when the linked contact is clear', async () => {
    state.adminContact = { do_not_contact: false };
    state.addressRows = [{ id: 'c-other' }];
    const res = await send('email');
    expect(res.status).toBe(409);
    expect(state.sent).toBe(0);
  });
});

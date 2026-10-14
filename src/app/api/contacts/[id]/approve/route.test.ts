import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  contact: {
    id: 'c1',
    name: 'Ali Yousuff',
    status: 'pending_review',
    last_inquired_property_id: 'prop-20',
  } as Record<string, unknown> | null,
  property: {
    id: 'prop-20',
    title: '2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase',
    status: 'Under Contract',
    location: 'JP Nagar 4th Phase, Bangalore',
    price: 84000000,
  } as Record<string, unknown> | null,
  contactUpdates: [] as Record<string, unknown>[],
  conversationUpdates: [] as Record<string, unknown>[],
  unavailable: null as Record<string, unknown> | null,
  details: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'agent',
    supabase: { from: table },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: table }),
}));

vi.mock('@/lib/contacts/approve-unavailable-listing', () => ({
  tellApprovedLeadListingUnavailable: async () => state.unavailable,
}));

vi.mock('@/lib/whatsapp/share-property-send', () => ({
  sendPropertyToContact: async (args: Record<string, unknown>) => {
    state.details.push(args);
    return { sent: true, channel: 'freeform', conversationId: 'conv-1' };
  },
}));

function table(name: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    update: (patch: Record<string, unknown>) => {
      if (name === 'contacts') state.contactUpdates.push(patch);
      if (name === 'conversations') state.conversationUpdates.push(patch);
      return builder;
    },
    maybeSingle: async () => ({
      data:
        name === 'contacts'
          ? state.contact
          : name === 'properties'
            ? state.property
            : name === 'showcase_settings'
              ? { subdomain: 'aryavarta', currency: 'INR' }
              : null,
      error: null,
    }),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({
        data: name === 'contacts' ? [{ id: 'c1' }] : [],
        error: null,
      }).then(resolve),
  };
  return builder;
}

import { POST } from './route';

const approve = () =>
  POST(
    new NextRequest('http://test/api/contacts/c1/approve', { method: 'POST' }),
    {
      params: Promise.resolve({ id: 'c1' }),
    }
  );

beforeEach(() => {
  state.contactUpdates = [];
  state.conversationUpdates = [];
  state.unavailable = null;
  state.details = [];
});

describe('POST /api/contacts/[id]/approve', () => {
  it('approves and sends the details of an available listing', async () => {
    const res = await approve();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.contactUpdates[0]).toMatchObject({ status: 'active' });
    expect(state.details).toHaveLength(1);
    expect(body.data).toMatchObject({
      approved: true,
      sent: true,
      channel: 'freeform',
      conversation_id: 'conv-1',
    });
    expect(body.data.unavailable).toBeUndefined();
    expect(state.conversationUpdates[0]).toMatchObject({ status: 'open' });
  });

  it('[CNV-007] sends the regret instead of the details when the listing has left the market', async () => {
    state.unavailable = {
      status: 'Under Contract',
      label: 'Under contract',
      notice: 'freeform',
      conversationId: 'conv-1',
      message:
        'Hi Ali, thank you for your interest … Browse every live listing any time: https://aryavarta.convoreal.com/?v=c1',
    };
    const res = await approve();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.contactUpdates[0]).toMatchObject({ status: 'active' });
    expect(state.details).toEqual([]);
    expect(body.data).toMatchObject({
      approved: true,
      sent: true,
      channel: 'freeform',
      conversation_id: 'conv-1',
      details_message: state.unavailable.message,
      unavailable: {
        status: 'Under Contract',
        label: 'Under contract',
        notice: 'freeform',
      },
    });
    expect(body.data.send_error).toBeUndefined();
    expect(state.conversationUpdates[0]).toMatchObject({ status: 'open' });
  });

  it('[CNV-007] reports a lead who already holds the regret as approved with nothing sent', async () => {
    state.unavailable = {
      status: 'Sold',
      label: 'Sold',
      notice: 'already_told',
      conversationId: 'conv-1',
      message: 'Hi Ali, …',
    };
    const body = await (await approve()).json();
    expect(state.details).toEqual([]);
    expect(body.data).toMatchObject({
      approved: true,
      sent: false,
      unavailable: { notice: 'already_told' },
    });
    expect(body.data.channel).toBeUndefined();
    expect(body.data.send_error).toBeUndefined();
  });

  it('[CNV-007] carries a failed regret as a send error beside the approval, never as a 5xx', async () => {
    state.unavailable = {
      status: 'Off Market',
      label: 'Off market',
      notice: 'failed',
      conversationId: null,
      message: 'Hi Ali, …',
    };
    const res = await approve();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      approved: true,
      sent: false,
      conversation_id: null,
      unavailable: { notice: 'failed' },
    });
    expect(body.data.send_error).toBeTruthy();
    expect(state.conversationUpdates).toEqual([]);
  });
});

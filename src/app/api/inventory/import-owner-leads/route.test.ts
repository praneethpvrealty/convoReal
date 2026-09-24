import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  contacts: [] as Record<string, unknown>[],
  properties: [] as Record<string, unknown>[],
  insertedContacts: [] as Record<string, unknown>[],
  insertedProperties: [] as Record<string, unknown>[],
  planAllowed: true,
};

function contactsQuery() {
  let matchedContacts = [...state.contacts];
  const query = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      matchedContacts = matchedContacts.filter((c) => c[col] === val);
      return query;
    },
    in: (col: string, vals: unknown[]) => {
      matchedContacts = matchedContacts.filter((c) => vals.includes(c[col]));
      return query;
    },
    limit: () => ({
      data: matchedContacts,
      error: null,
    }),
    insert: (values: Record<string, unknown>) => {
      state.insertedContacts.push(values);
      const created = { id: `contact-${state.insertedContacts.length}`, ...values };
      state.contacts.push(created);
      return {
        select: () => ({
          single: async () => ({
            data: created,
            error: null,
          }),
        }),
      };
    },
  };
  return query;
}

function propertiesQuery() {
  let matchedProperties = [...state.properties];
  const query = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      matchedProperties = matchedProperties.filter((p) => p[col] === val);
      return query;
    },
    limit: () => ({
      data: matchedProperties,
      error: null,
    }),
    insert: async (values: Record<string, unknown>) => {
      state.insertedProperties.push(values);
      const created = { id: `prop-${state.insertedProperties.length}`, ...values };
      state.properties.push(created);
      return { data: created, error: null };
    },
  };
  return query;
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    role: 'agent',
    userId: 'user-1',
    supabase: {
      from: (table: string) => {
        if (table === 'contacts') return contactsQuery();
        if (table === 'properties') return propertiesQuery();
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 1000 } },
}));

vi.mock('@/lib/billing/gates', () => ({
  checkPlanLimit: async () => ({ allowed: state.planAllowed }),
  gateResponse: () => Response.json({ error: 'upgrade required' }, { status: 402 }),
}));

import { POST } from './route';

describe('POST /api/inventory/import-owner-leads', () => {
  beforeEach(() => {
    state.contacts = [];
    state.properties = [];
    state.insertedContacts = [];
    state.insertedProperties = [];
    state.planAllowed = true;
  });

  it('rejects invalid payload if leads is not an array', async () => {
    const res = await POST(
      new Request('http://localhost/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: 'invalid' }),
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid payload');
  });

  it('returns count 0 if leads array is empty', async () => {
    const res = await POST(
      new Request('http://localhost/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: [] }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(0);
  });

  it('imports a new lead, creating an Owner Contact and Property', async () => {
    const res = await POST(
      new Request('http://localhost/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: [
            {
              id: 'lead-1',
              portal: '99acres',
              name: 'Ramesh Kumar',
              phone: '9880011223',
              title: '3 BHK Apartment in Indiranagar',
              price: '₹ 1.75 Cr',
              url: 'https://www.99acres.com/sample',
            },
          ],
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);

    expect(state.insertedContacts).toHaveLength(1);
    expect(state.insertedContacts[0]).toMatchObject({
      account_id: 'acc-1',
      name: 'Ramesh Kumar',
      phone: '+919880011223',
      classification: 'Owner',
      source: '99acres',
      status: 'active',
    });

    expect(state.insertedProperties).toHaveLength(1);
    expect(state.insertedProperties[0]).toMatchObject({
      account_id: 'acc-1',
      owner_contact_id: 'contact-1',
      title: '3 BHK Apartment in Indiranagar',
      price: 17500000,
      listing_source: 'owner',
      status: 'Available',
      type: 'Apartment',
    });
  });

  it('reuses existing contact if phone already exists', async () => {
    state.contacts.push({
      id: 'existing-contact-1',
      account_id: 'acc-1',
      name: 'Existing Owner',
      phone: '+919880011223',
    });

    const res = await POST(
      new Request('http://localhost/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: [
            {
              id: 'lead-2',
              portal: 'housing',
              name: 'Ignored Name',
              phone: '+919880011223',
              title: 'Plot for sale in Devanahalli',
              price: '₹ 45 Lac',
            },
          ],
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);

    // Did not insert a new contact
    expect(state.insertedContacts).toHaveLength(0);

    // Inserted property linked to existing contact
    expect(state.insertedProperties).toHaveLength(1);
    expect(state.insertedProperties[0].owner_contact_id).toBe('existing-contact-1');
    expect(state.insertedProperties[0].type).toBe('Plot');
    expect(state.insertedProperties[0].price).toBe(4500000);
  });

  it('skips duplicate property import if title matches for same owner', async () => {
    state.contacts.push({
      id: 'contact-abc',
      account_id: 'acc-1',
      phone: '+919880011223',
    });
    state.properties.push({
      id: 'prop-abc',
      account_id: 'acc-1',
      owner_contact_id: 'contact-abc',
      title: 'Villa in Whitefield',
    });

    const res = await POST(
      new Request('http://localhost/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: [
            {
              phone: '9880011223',
              title: 'Villa in Whitefield',
            },
          ],
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(state.insertedProperties).toHaveLength(0);
  });

  it('enforces billing plan gate', async () => {
    state.planAllowed = false;

    const res = await POST(
      new Request('http://localhost/api/inventory/import-owner-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: [{ phone: '9880011223', title: 'Test' }],
        }),
      })
    );

    expect(res.status).toBe(402);
  });
});

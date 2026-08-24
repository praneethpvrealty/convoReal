import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRole, checkRateLimit, createClient, findOrCreateContact } =
  vi.hoisted(() => ({
    requireRole: vi.fn(),
    checkRateLimit: vi.fn(),
    createClient: vi.fn(),
    findOrCreateContact: vi.fn(),
  }));

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit,
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

vi.mock('@/lib/contacts/find-or-create', () => ({ findOrCreateContact }));

import { POST } from './route';

function resolvedQuery(value: unknown, onUpsert?: (value: unknown) => void) {
  const query = {
    select: () => query,
    eq: () => query,
    upsert: (upsertValue?: unknown) => {
      onUpsert?.(upsertValue);
      return query;
    },
    maybeSingle: async () => value,
  };
  return query;
}

describe('POST /api/properties/[id]/share-to-agent-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ success: true });
  });

  it('adds a safe attributed copy to the recipient review queue', async () => {
    const source = {
      id: 'source-property',
      account_id: 'sender-account',
      title: 'Indiranagar Office',
      location: 'Indiranagar',
      type: 'Commercial Office',
      price: 50_000_000,
      is_published: true,
    };
    const ctxSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'properties') {
          return resolvedQuery({ data: source, error: null });
        }
        if (table === 'contacts') {
          return resolvedQuery({
            data: {
              id: 'recipient-contact',
              name: 'Agent B',
              phone: '+919900011223',
              classification: 'Agent',
            },
            error: null,
          });
        }
        return resolvedQuery({
          data: { full_name: 'Agent A', phone: '+919811122233' },
          error: null,
        });
      }),
    };
    requireRole.mockResolvedValue({
      accountId: 'sender-account',
      userId: 'sender-user',
      role: 'agent',
      supabase: ctxSupabase,
    });

    const inserted: Record<string, unknown>[] = [];
    let propertyCalls = 0;
    const admin = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ user_id: 'recipient-user', account_id: 'recipient-account' }],
        error: null,
      }),
      from: vi.fn((table: string) => {
        if (table === 'accounts') {
          return resolvedQuery({
            data: { name: 'Sender Realty' },
            error: null,
          });
        }
        propertyCalls += 1;
        if (propertyCalls === 1) {
          return resolvedQuery({ data: null, error: null });
        }
        return resolvedQuery(
          {
            data: {
              id: 'pending-copy',
              title: source.title,
              status: 'Pending Review',
            },
            error: null,
          },
          (row) => inserted.push(row as Record<string, unknown>)
        );
      }),
    };
    createClient.mockReturnValue(admin);
    findOrCreateContact.mockResolvedValue({
      contactId: 'sender-contact-in-recipient',
      isNew: true,
      matchedOn: 'created',
    });

    const response = await POST(
      new Request(
        'http://test/api/properties/source-property/share-to-agent-account',
        {
          method: 'POST',
          body: JSON.stringify({ contact_id: 'recipient-contact' }),
        }
      ),
      { params: Promise.resolve({ id: 'source-property' }) }
    );

    expect(response.status).toBe(201);
    expect(inserted[0]).toMatchObject({
      account_id: 'recipient-account',
      user_id: 'recipient-user',
      owner_contact_id: 'sender-contact-in-recipient',
      source_property_id: 'source-property',
      status: 'Pending Review',
      is_published: false,
    });
    expect(findOrCreateContact).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        accountId: 'recipient-account',
        userId: 'recipient-user',
        classification: 'Agent',
      })
    );
  });
});

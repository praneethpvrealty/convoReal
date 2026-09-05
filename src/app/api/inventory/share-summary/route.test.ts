import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 401 }
    ),
}));

import { GET } from './route';

const rows = [
  {
    id: 'p1',
    property_code: 'CR-1',
    title: 'Villa in Whitefield',
    type: 'Residential House',
    listing_type: 'Sale',
    price: 50000000,
    sublocality: 'Whitefield',
  },
  {
    id: 'p2',
    property_code: 'CR-2',
    title: 'Shop on 27th Main',
    type: 'Commercial Shop',
    listing_type: 'Sale',
    price: 30000000,
    sublocality: 'HSR Layout',
  },
];

function accountWith(data: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return {
    accountId: 'acc-1',
    supabase: { from: vi.fn().mockReturnValue(query) },
    query,
  };
}

async function callGet(query: string) {
  const response = await GET(
    new Request(`http://test/api/inventory/share-summary${query}`)
  );
  return (await response.json()) as {
    data: {
      summary: string;
      count: number;
      template_params: string[];
      personalized: Record<
        string,
        { summary: string; template_params: string[]; match_count: number }
      >;
    };
  };
}

describe('/api/inventory/share-summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('summarises the whole showcase, scoped to the session account', async () => {
    const ctx = accountWith(rows);
    getCurrentAccount.mockResolvedValue(ctx);

    const body = await callGet('?scope=all&portal_url=https://acme.test/');

    expect(ctx.query.eq).toHaveBeenCalledWith('account_id', 'acc-1');
    expect(ctx.query.eq).toHaveBeenCalledWith('is_published', true);
    expect(ctx.query.eq).toHaveBeenCalledWith('status', 'Available');
    expect(body.data.count).toBe(2);
    expect(body.data.summary).toContain('*RESIDENTIAL*');
    expect(body.data.summary).toContain('*COMMERCIAL*');
    expect(body.data.summary).toContain('https://acme.test/');
  });

  it('keeps only the named category', async () => {
    getCurrentAccount.mockResolvedValue(accountWith(rows));
    const body = await callGet('?scope=all&category=Commercial');
    expect(body.data.count).toBe(1);
    expect(body.data.summary).toContain('*COMMERCIAL*');
    expect(body.data.summary).not.toContain('*RESIDENTIAL*');
    expect(body.data.template_params[0]).toContain('no published options');
    expect(body.data.template_params[1]).toContain('Shop on 27th Main');
  });

  it('applies the search scope instead of the category', async () => {
    getCurrentAccount.mockResolvedValue(accountWith(rows));
    const body = await callGet('?scope=search&category=Residential&search=hsr');
    expect(body.data.count).toBe(1);
    expect(body.data.summary).toContain('Shop on 27th Main');
    expect(body.data.summary).not.toContain('Villa in Whitefield');
  });

  it('lists a hand-picked set in link order', async () => {
    getCurrentAccount.mockResolvedValue(accountWith(rows));
    const body = await callGet('?scope=pick&ids=CR-2');
    expect(body.data.count).toBe(1);
    expect(body.data.summary).toContain('Shop on 27th Main');
  });

  it('treats an empty pick as an empty share, not the whole catalog', async () => {
    getCurrentAccount.mockResolvedValue(accountWith(rows));
    const body = await callGet('?scope=pick&ids=');
    expect(body.data.count).toBe(0);
    expect(body.data.summary).toBe('');
  });

  it('returns the template body params for the same scope', () => {
    // {{2}}..{{4}} of inventory_update: one line per section, so a
    // surface without the builder can still send the template.
    getCurrentAccount.mockResolvedValue(accountWith(rows));
    return callGet('?scope=all').then((body) => {
      const [residential, commercial, farmAndLand] = body.data.template_params;
      expect(residential).toContain('Villa in Whitefield');
      expect(commercial).toContain('Shop on 27th Main');
      expect(farmAndLand).toContain('no published options');
    });
  });

  it('returns contact-ranked summaries and removes rejected listings', async () => {
    const propertyQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const thenable = (data: unknown[]) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      then(resolve: (value: { data: unknown[]; error: null }) => void) {
        resolve({ data, error: null });
      },
    });
    const contactQuery = thenable([
      {
        id: 'contact-1',
        user_id: 'user-1',
        phone: '+919999999999',
        name: 'Rahul Sharma',
        classification: 'Buyer',
        property_interests: ['Residential House'],
        areas_of_interest: ['Whitefield'],
        requirement_active: true,
      },
    ]);
    const feedbackQuery = thenable([
      { contact_id: 'contact-1', property_id: 'p2' },
    ]);
    getCurrentAccount.mockResolvedValue({
      accountId: 'acc-1',
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'properties') return propertyQuery;
          if (table === 'contacts') return contactQuery;
          return feedbackQuery;
        }),
        rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      },
    });

    const body = await callGet(
      '?scope=all&portal_url=https://acme.test/&contact_ids=contact-1'
    );
    const ranked = body.data.personalized['contact-1'];
    expect(ranked.summary).toContain('Hi Rahul!');
    expect(ranked.summary).toContain('Villa in Whitefield');
    expect(ranked.summary).not.toContain('Shop on 27th Main');
    expect(ranked.summary).toContain('v=contact-1');
    expect(ranked.match_count).toBe(1);
  });

  it('refuses an unauthenticated caller', async () => {
    getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));
    const response = await GET(
      new Request('http://test/api/inventory/share-summary')
    );
    expect(response.status).toBe(401);
  });
});

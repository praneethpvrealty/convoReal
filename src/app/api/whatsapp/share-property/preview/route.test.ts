import { beforeEach, describe, expect, it, vi } from 'vitest';

interface QueuedResponse {
  data?: unknown;
  error?: unknown;
}

let queues: Record<string, QueuedResponse[]>;

function makeDb() {
  return {
    from(table: string) {
      const response = (queues[table] ?? []).shift() ?? { data: null, error: null };
      const builder: { [k: string]: (...args: unknown[]) => unknown } = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve(response),
        then: (resolve: unknown, reject: unknown) =>
          Promise.resolve(response).then(
            resolve as (v: unknown) => unknown,
            reject as (v: unknown) => unknown
          ),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: makeDb(),
    accountId: 'acc-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    ),
}));

vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountBrandImage: async () => null,
  accountBrandName: async () => 'Acme Realty',
}));

vi.mock('@/lib/whatsapp/template-language', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/template-language')>()),
  resolveSendLanguage: async () => 'en',
}));

const { GET } = await import('./route');

const PROPERTY = {
  id: 'prop-1',
  title: 'Commercial BDA Property in HSR Layout',
  price: 250000000,
  listing_type: 'Sale',
  sublocality: 'HSR Layout Sector 2',
  city: 'Bangalore',
  type: 'Commercial Office',
  images: ['property-images/acc-1/front.jpg', 'property-images/acc-1/plan.jpg'],
};

const APPROVED_TEMPLATE = {
  id: 'tpl-1',
  name: 'new_property_alert',
  status: 'APPROVED',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Hi {{1}}! {{2}} — {{3}} at {{4}}.',
  buttons: [{ type: 'URL', text: 'View property', url: 'https://example.com/{{1}}' }],
};

function request(query: string) {
  return new Request(`http://localhost/api/whatsapp/share-property/preview${query}`) as never;
}

beforeEach(() => {
  queues = {};
});

describe('share-property preview', () => {
  it('requires a property id', async () => {
    const res = await GET(request(''));
    expect(res.status).toBe(400);
  });

  it('404s a listing outside the account', async () => {
    queues.properties = [{ data: null, error: null }];
    const res = await GET(request('?property_id=prop-9'));
    expect(res.status).toBe(404);
  });

  it('[PRP-012] returns the rendered template, its status and the listing photos', async () => {
    queues.properties = [{ data: PROPERTY, error: null }];
    queues.contacts = [{ data: { id: 'contact-1', name: 'Rajath Kumar' }, error: null }];
    queues.message_templates = [{ data: [APPROVED_TEMPLATE], error: null }];

    const res = await GET(request('?property_id=prop-1&contact_id=contact-1'));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.template).toMatchObject({ name: 'new_property_alert', label: 'Listing details' });
    expect(data.preview).toContain('Hi Rajath! Commercial BDA Property in HSR Layout — ₹25 Cr at HSR Layout Sector 2, Bangalore');
    expect(data.images).toEqual(PROPERTY.images);
    expect(data.unsent_reason).toBeNull();
  });

  it('[PRP-012] names the reason a closed window cannot be served', async () => {
    queues.properties = [{ data: PROPERTY, error: null }];
    queues.message_templates = [
      { data: [{ ...APPROVED_TEMPLATE, status: 'PENDING' }], error: null },
    ];

    const { data } = await (await GET(request('?property_id=prop-1'))).json();
    expect(data.template).toBeNull();
    expect(data.template_status).toBe('PENDING');
    expect(data.unsent_reason).toContain('awaiting Meta approval');
  });
});

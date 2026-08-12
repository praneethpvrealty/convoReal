// End-to-end: a real MCP client talks to the real server over an
// in-memory transport, and the server talks to a real HTTP server
// standing in for /api/v1. Nothing is mocked except the app itself, so
// these cover the whole path — schema validation, the fetch client,
// error translation and rendering.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ConvoRealClient } from './client.js';
import { createServer, resolveConfig } from './index.js';
import { formatMoney } from './format.js';
import { describeStatus } from './errors.js';

interface Handled {
  path: string;
  method: string;
  auth: string | undefined;
}

let http: Server;
let baseUrl: string;
let received: Handled[] = [];
/** Per-path canned responses: [status, body]. */
const routes = new Map<string, [number, unknown]>();

beforeAll(async () => {
  http = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    received.push({
      path: url.pathname + url.search,
      method: req.method ?? 'GET',
      auth: req.headers.authorization,
    });

    const route = routes.get(url.pathname);
    const [status, body] = route ?? [404, { error: 'no stub' }];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

async function connect(): Promise<Client> {
  received = [];
  const server = createServer(
    new ConvoRealClient({ baseUrl, apiKey: 'cvr_sk_test' })
  );
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] })
    .content;
  return content.map((c) => c.text).join('\n');
}

const emptyPage = {
  items: [],
  total: 0,
  count: 0,
  offset: 0,
  limit: 25,
  has_more: false,
  next_offset: null,
};

describe('resolveConfig', () => {
  it('defaults the base URL and keeps only the origin', () => {
    expect(
      resolveConfig({
        CONVOREAL_API_KEY: 'cvr_sk_x',
        CONVOREAL_BASE_URL: 'http://localhost:3000/api/',
      })
    ).toEqual({ apiKey: 'cvr_sk_x', baseUrl: 'http://localhost:3000' });
  });

  it('explains how to get a key when none is set', () => {
    expect(() => resolveConfig({})).toThrow(/Settings → API keys/);
  });

  it('rejects a Supabase token pasted into the key slot', () => {
    expect(() =>
      resolveConfig({ CONVOREAL_API_KEY: 'eyJhbGciOiJIUzI1NiJ9.x' })
    ).toThrow(/start with 'cvr_sk_'/);
  });

  it('rejects an unparseable base URL', () => {
    expect(() =>
      resolveConfig({
        CONVOREAL_API_KEY: 'cvr_sk_x',
        CONVOREAL_BASE_URL: 'not a url',
      })
    ).toThrow(/not a valid URL/);
  });
});

describe('formatMoney', () => {
  it('uses Indian short forms', () => {
    expect(formatMoney(12_500_000)).toBe('₹1.25 Cr');
    expect(formatMoney(8_500_000)).toBe('₹85 L');
    expect(formatMoney(40_000)).toBe('₹40,000');
  });

  it('renders a missing price as a dash rather than zero', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('falls back to a plain amount for other currencies', () => {
    expect(formatMoney(1000, 'USD')).toBe('USD 1,000');
  });
});

describe('describeStatus', () => {
  it('tells the agent to stop retrying on a scope failure', () => {
    expect(describeStatus(403, '/contacts')).toMatch(/'write' scope/);
  });

  it('names the rate limit and how to avoid it', () => {
    expect(describeStatus(429, '/properties')).toMatch(
      /120 API calls a minute/
    );
  });

  it("passes the server's own explanation through", () => {
    expect(describeStatus(400, '/contacts', "'name' is required")).toMatch(
      /'name' is required/
    );
  });
});

describe('tool surface', () => {
  it('registers every tool with a description and annotations', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(16);
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.annotations, `${tool.name} annotations`).toBeDefined();
    }
  });

  it('marks exactly the three mutating tools as writes', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    const writes = tools
      .filter((t) => t.annotations?.readOnlyHint === false)
      .map((t) => t.name);
    expect(writes.sort()).toEqual([
      'convoreal_add_contact_note',
      'convoreal_create_contact',
      'convoreal_create_todo',
    ]);
  });

  it('never marks a tool destructive — nothing here deletes', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.every((t) => t.annotations?.destructiveHint === false)).toBe(
      true
    );
  });
});

describe('convoreal_search_properties', () => {
  it('sends the API key and translates filters into query params', async () => {
    routes.set('/api/v1/properties', [200, emptyPage]);
    const client = await connect();

    await client.callTool({
      name: 'convoreal_search_properties',
      arguments: { query: 'Kokapet', max_price: 20_000_000, bedrooms: 3 },
    });

    const call = received[0]!;
    expect(call.auth).toBe('Bearer cvr_sk_test');
    expect(call.path).toContain('q=Kokapet');
    expect(call.path).toContain('max_price=20000000');
    expect(call.path).toContain('bedrooms=3');
  });

  it('omits filters the caller did not set', async () => {
    routes.set('/api/v1/properties', [200, emptyPage]);
    const client = await connect();

    await client.callTool({
      name: 'convoreal_search_properties',
      arguments: {},
    });

    expect(received[0]!.path).not.toContain('bedrooms');
    expect(received[0]!.path).not.toContain('q=');
  });

  it('renders listings with Indian short-form prices', async () => {
    routes.set('/api/v1/properties', [
      200,
      {
        ...emptyPage,
        total: 1,
        count: 1,
        items: [
          {
            id: 'p1',
            title: 'Skyline 3BHK',
            price: 12_500_000,
            location: 'Kokapet, Hyderabad',
            type: 'Flat/ Apartment',
            bedrooms: 3,
            area_sqft: 1800,
            status: 'Available',
            listing_type: 'Sale',
            is_published: true,
          },
        ],
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_search_properties',
        arguments: {},
      })
    );

    expect(text).toContain('Skyline 3BHK');
    expect(text).toContain('₹1.25 Cr');
    expect(text).toContain('3 BHK');
    expect(text).toContain('Kokapet, Hyderabad');
  });

  it('suggests how to widen an empty search', async () => {
    routes.set('/api/v1/properties', [200, emptyPage]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_search_properties',
        arguments: { query: 'zzz' },
      })
    );
    expect(text).toMatch(/No results/);
    expect(text).toMatch(/fewer filters/);
  });

  it('tells the caller how to page when more results exist', async () => {
    routes.set('/api/v1/properties', [
      200,
      {
        ...emptyPage,
        total: 50,
        count: 1,
        has_more: true,
        next_offset: 25,
        items: [{ id: 'p1', title: 'One', price: 100, is_published: false }],
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_search_properties',
        arguments: {},
      })
    );
    expect(text).toContain('offset: 25');
  });

  it('returns the raw envelope when json is requested', async () => {
    routes.set('/api/v1/properties', [
      200,
      {
        ...emptyPage,
        total: 1,
        count: 1,
        items: [{ id: 'p1', title: 'One', price: 100, is_published: false }],
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_search_properties',
        arguments: { response_format: 'json' },
      })
    );
    expect(JSON.parse(text)).toMatchObject({ total: 1, items: [{ id: 'p1' }] });
  });

  it('still returns parseable JSON when there are no results', async () => {
    routes.set('/api/v1/properties', [200, emptyPage]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_search_properties',
        arguments: { response_format: 'json' },
      })
    );
    expect(JSON.parse(text)).toMatchObject({ count: 0, items: [] });
  });

  it('rejects an out-of-range limit before making a request', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'convoreal_search_properties',
      arguments: { limit: 5000 },
    });

    expect(result.isError).toBe(true);
    expect(received).toHaveLength(0);
  });
});

describe('convoreal_match_contacts_for_property', () => {
  it('renders scores and reasons for each match', async () => {
    routes.set(
      '/api/v1/properties/11111111-1111-1111-1111-111111111111/matches',
      [
        200,
        {
          ...emptyPage,
          total: 1,
          count: 1,
          items: [
            {
              contact: {
                id: 'c1',
                name: 'Asha Rao',
                phone: '919876543210',
                classification: 'Buyer',
                lead_temp: 'HOT',
                budget: {
                  min: 10_000_000,
                  max: 15_000_000,
                  unconstrained: false,
                },
                areas_of_interest: ['Kokapet'],
                requirements: '3BHK near ORR',
                requirement_active: true,
                last_contacted_at: null,
                email: null,
              },
              score: 88,
              details: {
                type: 'match',
                location: 'match',
                budget: 'match',
                bhk: 'match',
                roi: 'unknown',
              },
              reasons: ['Type you asked for', 'In your area', 'Within budget'],
            },
          ],
        },
      ]
    );
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_match_contacts_for_property',
        arguments: { property_id: '11111111-1111-1111-1111-111111111111' },
      })
    );

    expect(text).toContain('Asha Rao');
    expect(text).toContain('score 88');
    expect(text).toContain('Within budget');
    expect(text).toContain('₹1 Cr – ₹1.5 Cr');
  });

  it('rejects a non-UUID property id without calling the API', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'convoreal_match_contacts_for_property',
      arguments: { property_id: 'not-a-uuid' },
    });

    expect(result.isError).toBe(true);
    expect(received).toHaveLength(0);
  });
});

describe('convoreal_match_properties_for_contact', () => {
  it("passes the server's note through when the contact has no brief", async () => {
    routes.set(
      '/api/v1/contacts/22222222-2222-2222-2222-222222222222/matches',
      [
        200,
        {
          ...emptyPage,
          note: 'This contact has no stated budget, area, project or requirement.',
        },
      ]
    );
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_match_properties_for_contact',
        arguments: { contact_id: '22222222-2222-2222-2222-222222222222' },
      })
    );
    expect(text).toContain('no stated budget');
  });
});

describe('write tools', () => {
  it('posts a new contact and echoes what was created', async () => {
    routes.set('/api/v1/contacts', [
      201,
      {
        contact: {
          id: 'c9',
          name: 'New Buyer',
          phone: '919000000000',
          email: null,
          classification: 'Buyer',
          lead_temp: null,
          budget: { min: null, max: null, unconstrained: false },
          areas_of_interest: [],
          requirements: 'Wants a plot',
          requirement_active: true,
          last_contacted_at: null,
        },
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_create_contact',
        arguments: {
          name: 'New Buyer',
          phone: '919000000000',
          requirements: 'Wants a plot',
        },
      })
    );

    expect(received[0]!.method).toBe('POST');
    expect(text).toContain('New Buyer');
  });

  it('explains the missing scope when the key is read-only', async () => {
    routes.set('/api/v1/todos', [
      403,
      { error: "This API key lacks the 'write' scope." },
    ]);
    const client = await connect();

    const result = await client.callTool({
      name: 'convoreal_create_todo',
      arguments: { title: 'Call the owner' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/write' scope/);
  });

  it('reports a duplicate contact as a conflict rather than a crash', async () => {
    routes.set('/api/v1/contacts', [
      409,
      {
        error:
          'A contact with this phone number already exists in this workspace.',
      },
    ]);
    const client = await connect();

    const result = await client.callTool({
      name: 'convoreal_create_contact',
      arguments: { name: 'Dupe', phone: '919000000000' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/already exists/);
  });
});

describe('error handling', () => {
  it('turns a rejected key into an actionable message', async () => {
    routes.set('/api/v1/deals', [401, { error: 'Invalid API key' }]);
    const client = await connect();

    const result = await client.callTool({
      name: 'convoreal_list_deals',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/CONVOREAL_API_KEY/);
  });

  it('never throws at the protocol level — failures come back as tool errors', async () => {
    routes.set('/api/v1/radar', [500, { error: 'boom' }]);
    const client = await connect();

    const result = await client.callTool({
      name: 'convoreal_list_radar_events',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/server error/);
  });
});

describe('convoreal_get_agenda', () => {
  it('renders appointments and to-dos as one briefing', async () => {
    routes.set('/api/v1/agenda', [
      200,
      {
        from: '2026-08-12T00:00:00.000Z',
        to: '2026-08-19T00:00:00.000Z',
        appointments: [
          {
            id: 'a1',
            title: 'Site visit',
            description: null,
            start_time: '2026-08-13T09:30:00.000Z',
            end_time: '2026-08-13T10:30:00.000Z',
            location: 'Kokapet',
            status: 'scheduled',
            contact: { id: 'c1', name: 'Asha Rao', phone: null },
            property: { id: 'p1', title: 'Skyline 3BHK' },
          },
        ],
        todos: [
          {
            id: 't1',
            title: 'Send brochure',
            description: null,
            due_date: '2026-08-12T00:00:00.000Z',
            priority: 'high',
            completed: false,
            contact: { id: 'c1', name: 'Asha Rao' },
          },
        ],
        truncated: { appointments: false, todos: false },
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({ name: 'convoreal_get_agenda', arguments: {} })
    );

    expect(text).toContain('Site visit');
    expect(text).toContain('Kokapet');
    expect(text).toContain('Send brochure');
    expect(text).toContain('Asha Rao');
  });
});

describe('portfolio tools', () => {
  const ownerStats = {
    linked_owners: 12,
    owners_with_listings: 9,
    properties: {
      total: 31,
      available: 18,
      under_contract: 4,
      sold: 9,
      published: 22,
    },
    asking_value_available: 412_500_000,
    asking_price_avg_available: 22_916_667,
    bids: { pending: 3, accepted: 1 },
  };

  const buyerStats = {
    linked_buyers: 20,
    buyers_with_budget: 16,
    buyers_unconstrained_budget: 2,
    buyers_with_requirement: 14,
    budget: {
      min_avg: 6_500_000,
      max_avg: 14_200_000,
      max_median: 12_500_000,
      max_lowest: 3_500_000,
      max_highest: 45_000_000,
    },
    shortlist: { items: 58, buyers_with_items: 11 },
  };

  it('reports both sides of the portfolio in one call', async () => {
    routes.set('/api/v1/portfolio/summary', [
      200,
      { owners: ownerStats, buyers: buyerStats },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_get_portfolio_summary',
        arguments: {},
      })
    );

    // Owner side: stock and what it is worth.
    expect(text).toContain('18 (58%)');
    expect(text).toContain('₹41.25 Cr');
    expect(text).toContain('Bids pending');

    // Buyer side: the average the user actually asked for.
    expect(text).toContain('₹1.42 Cr');
    expect(text).toContain('₹1.25 Cr');
    expect(text).toContain('₹35 L – ₹4.5 Cr');
  });

  it('keeps unconstrained buyers out of the averages and labels them', async () => {
    routes.set('/api/v1/portfolio/summary', [
      200,
      { owners: ownerStats, buyers: buyerStats },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_get_portfolio_summary',
        arguments: {},
      })
    );
    expect(text).toContain('No budget ceiling');
  });

  it('omits an average nobody could compute rather than printing zero', async () => {
    routes.set('/api/v1/portfolio/summary', [
      200,
      {
        owners: {
          ...ownerStats,
          properties: { ...ownerStats.properties, available: 0, total: 0 },
          asking_value_available: null,
          asking_price_avg_available: null,
        },
        buyers: {
          ...buyerStats,
          buyers_with_budget: 0,
          budget: {
            min_avg: null,
            max_avg: null,
            max_median: null,
            max_lowest: null,
            max_highest: null,
          },
        },
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_get_portfolio_summary',
        arguments: {},
      })
    );
    expect(text).not.toContain('Average budget');
    expect(text).not.toContain('Average asking price');
    expect(text).not.toContain('₹0');
  });

  it('lists owners with their stock', async () => {
    routes.set('/api/v1/portfolio/owners', [
      200,
      {
        ...emptyPage,
        total: 1,
        count: 1,
        items: [
          {
            den_user_id: 'd1',
            contact_id: 'c1',
            name: 'Ramesh Gupta',
            phone: '919876543210',
            linked_at: '2026-03-01T00:00:00.000Z',
            digest_frequency: 'weekly',
            properties: { total: 4, available: 3, sold: 1 },
            asking_value_available: 68_000_000,
            bids_pending: 2,
          },
        ],
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_list_portfolio_owners',
        arguments: {},
      })
    );

    expect(text).toContain('Ramesh Gupta');
    expect(text).toContain('4 total · 3 available · 1 sold');
    expect(text).toContain('₹6.8 Cr');
  });

  it('lists buyers ranked by budget', async () => {
    routes.set('/api/v1/portfolio/buyers', [
      200,
      {
        ...emptyPage,
        total: 1,
        count: 1,
        items: [
          {
            buyer_user_id: 'b1',
            contact_id: 'c2',
            name: 'Asha Rao',
            phone: '919000000000',
            linked_at: '2026-04-02T00:00:00.000Z',
            budget: { min: 9_000_000, max: 13_000_000, unconstrained: false },
            areas_of_interest: ['Kokapet', 'Narsingi'],
            requirements: '3BHK near ORR',
            requirement_active: true,
            shortlist_count: 6,
          },
        ],
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_list_portfolio_buyers',
        arguments: {},
      })
    );

    expect(text).toContain('Asha Rao');
    expect(text).toContain('₹90 L – ₹1.3 Cr');
    expect(text).toContain('Kokapet, Narsingi');
    expect(text).toContain('3BHK near ORR');
  });

  it('says "no ceiling" rather than a blank budget', async () => {
    routes.set('/api/v1/portfolio/buyers', [
      200,
      {
        ...emptyPage,
        total: 1,
        count: 1,
        items: [
          {
            buyer_user_id: 'b2',
            contact_id: 'c3',
            name: 'Big Fund',
            phone: null,
            linked_at: null,
            budget: { min: null, max: null, unconstrained: true },
            areas_of_interest: [],
            requirements: null,
            requirement_active: true,
            shortlist_count: 0,
          },
        ],
      },
    ]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_list_portfolio_buyers',
        arguments: {},
      })
    );
    expect(text).toContain('no ceiling');
  });

  it('explains how a portal login is obtained when nobody has one', async () => {
    routes.set('/api/v1/portfolio/owners', [200, emptyPage]);
    const client = await connect();

    const text = textOf(
      await client.callTool({
        name: 'convoreal_list_portfolio_owners',
        arguments: {},
      })
    );
    expect(text).toMatch(/verifying their WhatsApp number/);
  });
});

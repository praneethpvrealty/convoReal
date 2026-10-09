import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTERACTIVE_LIMITS,
  sendFlowMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendTemplateMessage,
  syncProductToCatalog,
} from './meta-api';

// All assertions in this file run BEFORE the network call. We stub fetch
// to a never-resolving mock so a test that accidentally falls through to
// the request body would hang (and fail) rather than silently hit
// graph.facebook.com.
const neverFetch = () =>
  new Promise<Response>(() => {
    /* intentionally never resolves */
  });

const BASE_ARGS = {
  phoneNumberId: 'test-phone',
  accessToken: 'test-token',
  to: '1234567890',
  bodyText: 'Body text',
} as const;

describe('sendInteractiveButtons — validation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an empty buttons array', async () => {
    await expect(
      sendInteractiveButtons({ ...BASE_ARGS, buttons: [] })
    ).rejects.toThrow(/1-3 buttons/);
  });

  it(`rejects more than ${INTERACTIVE_LIMITS.maxButtons} buttons (Meta cap)`, async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' },
        ],
      })
    ).rejects.toThrow(/1-3 buttons/);
  });

  it('rejects a button title longer than 20 chars (Meta cap)', async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          {
            id: 'a',
            title: 'x'.repeat(INTERACTIVE_LIMITS.buttonTitleMaxLength + 1),
          },
        ],
      })
    ).rejects.toThrow(/exceeds 20 chars/);
  });

  it('rejects a button missing its id', async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [{ id: '', title: 'Choose me' }],
      })
    ).rejects.toThrow(/missing id/);
  });

  it('rejects an empty body text', async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        bodyText: '',
        buttons: [{ id: 'a', title: 'A' }],
      })
    ).rejects.toThrow(/requires bodyText/);
  });

  it('rejects a header text over the limit', async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        headerText: 'x'.repeat(INTERACTIVE_LIMITS.headerTextMaxLength + 1),
        buttons: [{ id: 'a', title: 'A' }],
      })
    ).rejects.toThrow(/headerText exceeds/);
  });

  it('sends the right payload shape when all inputs are valid', async () => {
    let captured: { url: string; body: unknown; method: string } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        captured = {
          url,
          method: init.method ?? 'GET',
          body: JSON.parse(String(init.body)),
        };
        return new Response(
          JSON.stringify({ messages: [{ id: 'wamid.PASS' }] }),
          { status: 200 }
        );
      })
    );

    const result = await sendInteractiveButtons({
      ...BASE_ARGS,
      headerText: 'Hello',
      footerText: 'Tap one',
      buttons: [
        { id: 'yes', title: 'Yes' },
        { id: 'no', title: 'No' },
      ],
    });

    expect(result).toEqual({ messageId: 'wamid.PASS' });
    expect(captured).not.toBeNull();
    expect(captured!.method).toBe('POST');
    expect(captured!.url).toContain('test-phone/messages');
    expect(captured!.body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '1234567890',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Body text' },
        header: { type: 'text', text: 'Hello' },
        footer: { text: 'Tap one' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'yes', title: 'Yes' } },
            { type: 'reply', reply: { id: 'no', title: 'No' } },
          ],
        },
      },
    });
  });
});

describe('sendInteractiveList — validation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ROW = { id: 'r1', title: 'Row 1' };

  it('rejects zero sections', async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: 'Open',
        sections: [],
      })
    ).rejects.toThrow(/1-10 sections/);
  });

  it(`rejects more than ${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across sections (Meta cap)`, async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: `r${i}`,
      title: `Row ${i}`,
    }));
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: 'Open',
        sections: [{ rows }],
      })
    ).rejects.toThrow(/1-10 rows total/);
  });

  it('rejects a row title longer than 24 chars (Meta cap)', async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: 'Open',
        sections: [
          {
            rows: [
              {
                id: 'r1',
                title: 'x'.repeat(INTERACTIVE_LIMITS.listRowTitleMaxLength + 1),
              },
            ],
          },
        ],
      })
    ).rejects.toThrow(/exceeds 24 chars/);
  });

  it('rejects duplicate row ids across sections', async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: 'Open',
        sections: [
          { rows: [{ id: 'dupe', title: 'First' }] },
          { rows: [{ id: 'dupe', title: 'Second' }] },
        ],
      })
    ).rejects.toThrow(/duplicate row id/);
  });

  it('rejects an empty buttonLabel', async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: '',
        sections: [{ rows: [ROW] }],
      })
    ).rejects.toThrow(/requires a buttonLabel/);
  });

  it('sends the right payload shape when valid', async () => {
    let captured: { body: unknown } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = { body: JSON.parse(String(init.body)) };
        return new Response(
          JSON.stringify({ messages: [{ id: 'wamid.LIST' }] }),
          { status: 200 }
        );
      })
    );

    const result = await sendInteractiveList({
      ...BASE_ARGS,
      buttonLabel: 'Open menu',
      sections: [
        {
          title: 'Orders',
          rows: [
            { id: 'order_1', title: 'Order #1', description: '€12' },
            { id: 'order_2', title: 'Order #2' },
          ],
        },
      ],
    });

    expect(result).toEqual({ messageId: 'wamid.LIST' });
    expect(captured).not.toBeNull();
    expect(captured!.body).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: 'Body text' },
        action: {
          button: 'Open menu',
          sections: [
            {
              title: 'Orders',
              rows: [
                { id: 'order_1', title: 'Order #1', description: '€12' },
                { id: 'order_2', title: 'Order #2' },
              ],
            },
          ],
        },
      },
    });
  });
});

describe('sendTemplateMessage — language fallback retry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries sequentially with 'en' then 'en_GB' when 'en_US' fails with 132001, and succeeds on the last one", async () => {
    let callCount = 0;
    const capturedPayloads: Array<{
      template?: { language?: { code?: string } };
    }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        callCount++;
        const body = JSON.parse(String(init.body)) as {
          template?: { language?: { code?: string } };
        };
        capturedPayloads.push(body);

        if (callCount < 3) {
          return new Response(
            JSON.stringify({
              error: {
                message: 'Template name does not exist in the translation',
                code: 132001,
              },
            }),
            { status: 400 }
          );
        }

        return new Response(
          JSON.stringify({ messages: [{ id: 'wamid.GB_SUCCESS' }] }),
          { status: 200 }
        );
      })
    );

    const result = await sendTemplateMessage({
      phoneNumberId: 'test-phone',
      accessToken: 'test-token',
      to: '1234567890',
      templateName: 'share_property_details',
      language: 'en_US',
      params: ['hello'],
    });

    expect(result).toEqual({ messageId: 'wamid.GB_SUCCESS' });
    expect(callCount).toBe(3);
    expect(capturedPayloads[0].template?.language?.code).toBe('en_US');
    expect(capturedPayloads[1].template?.language?.code).toBe('en');
    expect(capturedPayloads[2].template?.language?.code).toBe('en_GB');
  });

  it("retries once with 'en_US' when 'en' fails with 132001, and succeeds", async () => {
    let callCount = 0;
    const capturedPayloads: Array<{
      template?: { language?: { code?: string } };
    }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        callCount++;
        const body = JSON.parse(String(init.body)) as {
          template?: { language?: { code?: string } };
        };
        capturedPayloads.push(body);

        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message: 'Template name does not exist in the translation',
                code: 132001,
              },
            }),
            { status: 400 }
          );
        }

        return new Response(
          JSON.stringify({ messages: [{ id: 'wamid.RETRY_SUCCESS_2' }] }),
          { status: 200 }
        );
      })
    );

    const result = await sendTemplateMessage({
      phoneNumberId: 'test-phone',
      accessToken: 'test-token',
      to: '1234567890',
      templateName: 'share_property_details',
      language: 'en',
      params: ['hello'],
    });

    expect(result).toEqual({ messageId: 'wamid.RETRY_SUCCESS_2' });
    expect(callCount).toBe(2);
    expect(capturedPayloads[0].template?.language?.code).toBe('en');
    expect(capturedPayloads[1].template?.language?.code).toBe('en_US');
  });

  it('does not retry for other error codes and fails', async () => {
    let callCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount++;
        return new Response(
          JSON.stringify({
            error: {
              message: 'Some other error',
              code: 100,
            },
          }),
          { status: 400 }
        );
      })
    );

    await expect(
      sendTemplateMessage({
        phoneNumberId: 'test-phone',
        accessToken: 'test-token',
        to: '1234567890',
        templateName: 'share_property_details',
        language: 'en_US',
        params: ['hello'],
      })
    ).rejects.toThrow(/Some other error/);

    expect(callCount).toBe(1);
  });
});

describe('sendFlowMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const FLOW_ARGS = {
    ...BASE_ARGS,
    flowId: '1234567890',
    flowToken: 'tok-abc',
    flowCta: 'Update preferences',
  } as const;

  it('rejects a missing flowId / flowToken / flowCta', async () => {
    await expect(sendFlowMessage({ ...FLOW_ARGS, flowId: '' })).rejects.toThrow(
      /requires flowId/
    );
    await expect(
      sendFlowMessage({ ...FLOW_ARGS, flowToken: '' })
    ).rejects.toThrow(/requires flowToken/);
    await expect(
      sendFlowMessage({ ...FLOW_ARGS, flowCta: '' })
    ).rejects.toThrow(/requires flowCta/);
  });

  it('rejects a CTA longer than 30 chars', async () => {
    await expect(
      sendFlowMessage({ ...FLOW_ARGS, flowCta: 'x'.repeat(31) })
    ).rejects.toThrow(/exceeds 30 chars/);
  });

  it('rejects navigate mode without a target screen', async () => {
    await expect(
      sendFlowMessage({ ...FLOW_ARGS, flowAction: 'navigate' })
    ).rejects.toThrow(/requires flowActionPayload.screen/);
  });

  it('rejects a flowActionPayload in data_exchange mode', async () => {
    await expect(
      sendFlowMessage({
        ...FLOW_ARGS,
        flowAction: 'data_exchange',
        flowActionPayload: { screen: 'PREFERENCES' },
      })
    ).rejects.toThrow(/only valid with flow_action "navigate"/);
  });

  it('sends the documented interactive flow payload', async () => {
    let captured: unknown = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ messages: [{ id: 'wamid.FLOW1' }] }),
          { status: 200 }
        );
      })
    );

    const result = await sendFlowMessage({ ...FLOW_ARGS, footerText: '1 min' });
    expect(result.messageId).toBe('wamid.FLOW1');

    const body = captured as Record<string, unknown>;
    const interactive = body.interactive as Record<string, unknown>;
    expect(body.type).toBe('interactive');
    expect(interactive.type).toBe('flow');
    const action = interactive.action as {
      name: string;
      parameters: Record<string, unknown>;
    };
    expect(action.name).toBe('flow');
    expect(action.parameters).toEqual({
      flow_message_version: '3',
      flow_token: 'tok-abc',
      flow_id: '1234567890',
      flow_cta: 'Update preferences',
      mode: 'published',
      flow_action: 'data_exchange',
    });
  });
});

describe('[PRP-044] syncProductToCatalog — confirms the item reached the catalog', () => {
  const property = {
    id: 'p1',
    property_code: 'PROP-1111',
    title: 'Plot',
    price: 110600000,
    type: 'Commercial Land',
    location: 'ITPL Road',
    images: [],
  } as unknown as Parameters<typeof syncProductToCatalog>[0]['property'];
  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMeta(
    batchStatus: unknown,
    products: unknown
  ): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/batch')) return json({ handles: ['h1'] });
      if (url.includes('check_batch_request_status')) return json(batchStatus);
      if (url.includes('/products?')) return json(products);
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('fails the sync with the reason Meta rejected the item for', async () => {
    stubMeta(
      { data: [{ status: 'finished', errors: [{ message: 'Bad image' }] }] },
      { data: [] }
    );
    await expect(
      syncProductToCatalog({ catalogId: 'c1', accessToken: 't', property })
    ).rejects.toThrow('Meta rejected the catalog item: Bad image');
  });

  it('fails the sync when Meta counts errors it does not describe', async () => {
    stubMeta(
      { data: [{ status: 'finished', errors_total_count: 1, errors: [] }] },
      { data: [{ id: '9', retailer_id: 'PROP-1111' }] }
    );
    await expect(
      syncProductToCatalog({ catalogId: 'c1', accessToken: 't', property })
    ).rejects.toThrow('Meta rejected the catalog item: 1 error(s) reported');
  });

  it('fails the sync when the finished batch left no product behind', async () => {
    stubMeta({ data: [{ status: 'finished', errors: [] }] }, { data: [] });
    await expect(
      syncProductToCatalog({ catalogId: 'c1', accessToken: 't', property })
    ).rejects.toThrow('PROP-1111 is not in catalog c1');
  });

  it('never calls an unfinished batch synced when the product is absent', async () => {
    vi.useFakeTimers();
    try {
      stubMeta({ data: [{ status: 'started', errors: [] }] }, { data: [] });
      const sync = syncProductToCatalog({
        catalogId: 'c1',
        accessToken: 't',
        property,
      });
      const settled = expect(sync).rejects.toThrow(
        'Meta is still processing PROP-1111'
      );
      await vi.runAllTimersAsync();
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the sync when the catalog lookup errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/batch')) return json({ handles: ['h1'] });
        if (url.includes('check_batch_request_status'))
          return json({ data: [{ status: 'finished', errors: [] }] });
        return Promise.resolve(new Response('{}', { status: 503 }));
      })
    );
    await expect(
      syncProductToCatalog({ catalogId: 'c1', accessToken: 't', property })
    ).rejects.toThrow('Could not confirm PROP-1111 in Meta Catalog: 503');
  });

  it('never calls an unfinished batch synced, even with an older product row', async () => {
    vi.useFakeTimers();
    try {
      stubMeta(
        { data: [{ status: 'started', errors: [] }] },
        { data: [{ id: '9', retailer_id: 'PROP-1111' }] }
      );
      const sync = syncProductToCatalog({
        catalogId: 'c1',
        accessToken: 't',
        property,
      });
      const settled = expect(sync).rejects.toThrow(
        'Meta is still processing PROP-1111'
      );
      await vi.runAllTimersAsync();
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the sync when Meta returns no batch handle', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/batch')) return json({});
      return json({ data: [{ id: '9', retailer_id: 'PROP-1111' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      syncProductToCatalog({ catalogId: 'c1', accessToken: 't', property })
    ).rejects.toThrow('Meta did not return a batch handle for PROP-1111');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('succeeds once the product is in the catalog', async () => {
    const fetchMock = stubMeta(
      { data: [{ status: 'finished', errors: [] }] },
      { data: [{ id: '9', retailer_id: 'PROP-1111' }] }
    );
    await expect(
      syncProductToCatalog({ catalogId: 'c1', accessToken: 't', property })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends the price in the currency's minor units, as Meta's batch API expects", async () => {
    const batchPrice = async (currency: string, price: number) => {
      const fetchMock = stubMeta(
        { data: [{ status: 'finished', errors: [] }] },
        { data: [{ id: '9', retailer_id: 'PROP-1111' }] }
      );
      await syncProductToCatalog({
        catalogId: 'c1',
        accessToken: 't',
        property: { ...property, price },
        currency,
      });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return JSON.parse(String(init.body)).requests[0].data.price;
    };
    expect(await batchPrice('INR', 110600000)).toBe(11060000000);
    expect(await batchPrice('AED', 1250000.5)).toBe(125000050);
    expect(await batchPrice('JPY', 50000000)).toBe(50000000);
  });

  it('prices the catalog item in the currency it is given, INR otherwise', async () => {
    const batchCurrency = async (currency?: string) => {
      const fetchMock = stubMeta(
        { data: [{ status: 'finished', errors: [] }] },
        { data: [{ id: '9', retailer_id: 'PROP-1111' }] }
      );
      await syncProductToCatalog({
        catalogId: 'c1',
        accessToken: 't',
        property,
        currency,
      });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return JSON.parse(String(init.body)).requests[0].data.currency;
    };
    expect(await batchCurrency('AED')).toBe('AED');
    expect(await batchCurrency()).toBe('INR');
  });
});

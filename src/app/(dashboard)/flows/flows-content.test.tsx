// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FlowsPage, { formatItemPrice, goLiveConsequence } from './flows-content';

const push = vi.fn();
const auth = vi.hoisted(() => ({ isReadOnly: false }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1', isReadOnly: auth.isReadOnly }),
}));

vi.mock('@/hooks/useCan', () => ({
  useCan: (action: string) =>
    action === 'make-changes' ? !auth.isReadOnly : true,
}));

vi.mock('@/lib/marketplace/checkout', () => ({
  openRazorpayCheckout: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

function flow(over: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    name: 'Welcome menu',
    description: null,
    status: 'active',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['hi'] },
    execution_count: 3,
    last_executed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    name: 'Greeter',
    description: 'Says hello',
    icon: null,
    trigger_type: 'first_inbound_message',
    price_cents: 0,
    currency: 'INR',
    account_status: null,
    account_flow_id: null,
    purchased_at: null,
    ...over,
  };
}

type Handler = (url: string, init?: RequestInit) => unknown;

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

function renderFlows(handler: Handler) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    handler(url, init)
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FlowsPage />
    </QueryClientProvider>
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
  auth.isReadOnly = false;
});

describe('FlowsPage', () => {
  it('shows a retryable error rather than "No flows yet" when flows fail to load', async () => {
    let fail = true;
    renderFlows((url) => {
      if (url === '/api/flows') {
        return fail ? { ok: false, json: async () => ({}) } : ok({ flows: [] });
      }
      return ok({ templates: [], items: [] });
    });
    await screen.findByText(/Couldn.t load your flows/);
    expect(screen.queryByText('No flows yet')).toBe(null);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No flows yet');
  });

  it('disables creating and activating flows for a read-only member', async () => {
    auth.isReadOnly = true;
    renderFlows((url) =>
      url === '/api/flows'
        ? ok({ flows: [flow()] })
        : ok({ templates: [], items: [item()] })
    );
    await screen.findByText('Welcome menu');
    const newFlow = screen.getByRole('button', { name: /New flow/ });
    expect((newFlow as HTMLButtonElement).disabled).toBe(true);
    expect(newFlow.parentElement?.getAttribute('title')).toBe(
      "Read-only — your role can't create flows"
    );
    expect(screen.queryByRole('button', { name: /Delete/ })).toBe(null);
    expect(screen.getByRole('button', { name: /View/ })).toBeTruthy();
    const activate = await screen.findByRole('button', { name: /Activate/ });
    expect((activate as HTMLButtonElement).disabled).toBe(true);
    expect(activate.parentElement?.getAttribute('title')).toBe(
      "Read-only — your role can't change flows"
    );
  });

  it('shows when each flow last ran', async () => {
    renderFlows((url) =>
      url === '/api/flows'
        ? ok({ flows: [flow()] })
        : ok({ templates: [], items: [] })
    );
    await screen.findByText('Welcome menu');
    expect(screen.getByText('Last run 5m ago')).toBeTruthy();
  });

  it('badges a never-bought item as Available and formats its price', async () => {
    renderFlows((url) => {
      if (url === '/api/flows') return ok({ flows: [] });
      if (url === '/api/marketplace/items') {
        return ok({ items: [item({ price_cents: 49900 })] });
      }
      return ok({ templates: [] });
    });
    await screen.findByText('Greeter');
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.queryByText('Disabled')).toBe(null);
    expect(screen.getByText(formatItemPrice(49900, 'INR'))).toBeTruthy();
  });

  it('asks before a free marketplace flow goes live, naming what it will do', async () => {
    const fetchMock = renderFlows((url, init) => {
      if (url === '/api/flows') return ok({ flows: [] });
      if (url === '/api/marketplace/items') return ok({ items: [item()] });
      if (init?.method === 'POST') return ok({ success: true, flow_id: 'f9' });
      return ok({ templates: [] });
    });
    fireEvent.click(await screen.findByRole('button', { name: /Activate/ }));
    await screen.findByText('Will reply to every first-time customer.', {
      exact: false,
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/flows/f9'));
    expect(
      fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]
    ).toBe('/api/marketplace/items/m1/activate');
  });

  it('creates only one blank flow on a double Enter', async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    const fetchMock = renderFlows((url, init) => {
      if (url === '/api/flows' && init?.method === 'POST') {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      if (url === '/api/flows') return ok({ flows: [] });
      return ok({ templates: [], items: [] });
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /Create your first flow/ })
    );
    const input = await screen.findByPlaceholderText('e.g. Welcome menu');
    fireEvent.change(input, { target: { value: 'Menu' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    resolveCreate(ok({ flow: flow({ id: 'new' }) }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/flows/new'));
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/flows' && init?.method === 'POST'
      )
    ).toHaveLength(1);
  });
});

describe('goLiveConsequence', () => {
  it('names what each trigger will do once live', () => {
    expect(goLiveConsequence('first_inbound_message')).toBe(
      'Will reply to every first-time customer.'
    );
    expect(goLiveConsequence('keyword')).toMatch(/keywords/);
    expect(goLiveConsequence('manual')).toMatch(/starts it/);
  });
});

describe('formatItemPrice', () => {
  it('reads Free at zero and uses the item currency otherwise', () => {
    expect(formatItemPrice(0, 'INR')).toBe('Free');
    expect(formatItemPrice(49900, 'INR')).toMatch(/499/);
    expect(formatItemPrice(1000, 'NOT-A-CODE')).toBe('10.00 NOT-A-CODE');
  });
});

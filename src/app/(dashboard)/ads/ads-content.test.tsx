// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.stubEnv('NEXT_PUBLIC_META_ADS_APP_ID', 'meta-app-test');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/use-can', () => ({ useCan: () => can.value }));

const CAMPAIGN = {
  id: 'camp-1',
  propertyId: 'prop-1',
  propertyTitle: 'Maple Grove',
  propertyCode: 'MB-101',
  propertyImage: null,
  status: 'ACTIVE',
  dailyBudgetInr: 500,
  currency: 'INR',
  headline: 'Maple Grove',
  createdAt: '2026-10-01T00:00:00Z',
  insights: {
    spend: 1500,
    impressions: 9000,
    reach: 4000,
    conversationsStarted: 12,
    fetchedAt: '2026-10-02T00:00:00Z',
    stale: false,
  },
  leadsInEngine: 6,
  costPerLeadInr: 250,
};

const CONNECTED = {
  status: 'connected',
  adAccountId: 'act_123',
  pageId: 'page_1',
  currency: 'INR',
};

function connection(status: string) {
  return { ...CONNECTED, status };
}

function respond(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    handler(url, init)
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockCampaigns(
  conn: ReturnType<typeof connection> | null,
  campaigns: unknown[] = [CAMPAIGN]
) {
  return stubFetch(() => respond({ campaigns, connection: conn }));
}

async function renderAds(waitFor_ = 'Maple Grove') {
  const { default: AdsPage } = await import('./ads-content');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdsPage />
    </QueryClientProvider>
  );
  await screen.findByText(waitFor_);
}

beforeEach(() => {
  vi.resetModules();
  can.value = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdsPage Meta connection state', () => {
  it('[PRP-029] warns that the Meta connection expired and says ads keep running on Meta', async () => {
    mockCampaigns(connection('token_expired'));

    await renderAds();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Your Meta connection expired');
    expect(alert.textContent).toContain(
      'Your ads keep running and billing on Meta.'
    );
    expect(alert.textContent).toContain(
      'To pause an ad or change a budget here, reconnect Meta first.'
    );
    expect(
      screen.getByRole('link', { name: 'Reconnect Meta' }).getAttribute('href')
    ).toBe('/settings?tab=ads');
  });

  it('[PRP-029] shows the same reconnect banner when Meta is disconnected', async () => {
    mockCampaigns(connection('disconnected'));

    await renderAds();

    expect(screen.getByRole('alert').textContent).toContain(
      'Meta is disconnected'
    );
    expect(screen.getByRole('link', { name: 'Reconnect Meta' })).toBeTruthy();
  });

  it('[PRP-029] marks the figures as of the last sync and disables managing while expired', async () => {
    mockCampaigns(connection('token_expired'));

    await renderAds();

    expect(screen.getByText(/^as of /)).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Pause ad for Maple Grove',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('[PRP-029] shows a connected chip and no warning while connected', async () => {
    mockCampaigns(connection('connected'));

    await renderAds();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Connected · act_123 · INR/)).toBeTruthy();
    expect(screen.queryByText(/^as of /)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Reconnect Meta' })).toBeNull();
  });

  it('[PRP-029] shows the three-step intro instead of the empty state when Meta is not connected', async () => {
    mockCampaigns(connection('not_connected'), []);

    await renderAds('Connect Meta to start advertising');

    expect(screen.getByText('Connect Meta in Settings → Ads')).toBeTruthy();
    expect(
      screen.getByText('Choose your ad account and Facebook Page')
    ).toBeTruthy();
    expect(screen.getByText('Promote a property from Inventory')).toBeTruthy();
    expect(screen.queryByText('No campaigns yet')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Connect Meta' }).getAttribute('href')
    ).toBe('/settings?tab=ads');
  });

  it('[PRP-029] shows the intro when there is no connection at all', async () => {
    mockCampaigns(null, []);

    await renderAds('Connect Meta to start advertising');
  });
});

describe('AdsPage loading and errors', () => {
  it('[PRP-029] shows an error with Retry, never the empty state, when the load fails', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? respond({ error: 'Failed to load campaigns' }, false)
        : respond({ campaigns: [CAMPAIGN], connection: CONNECTED });
    });

    await renderAds("Couldn't load your ads");

    expect(screen.queryByText('No campaigns yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Maple Grove');
  });

  it('[PRP-029] keeps the heading visible behind one loading skeleton', async () => {
    stubFetch(() => new Promise(() => undefined));
    const { default: AdsPage } = await import('./ads-content');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdsPage />
      </QueryClientProvider>
    );

    expect(screen.getByRole('heading', { name: 'Ads' })).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('AdsPage figures', () => {
  it('[PRP-029] labels the window and renames the lead columns', async () => {
    mockCampaigns(CONNECTED);

    await renderAds();

    expect(screen.getByText('Chats (Meta)')).toBeTruthy();
    expect(screen.getByText('New contacts (ConvoReal)')).toBeTruthy();
    expect(screen.getAllByText('(last 30 days)')).toHaveLength(5);
  });

  it('[PRP-029] formats money in the ad account currency', async () => {
    mockCampaigns(CONNECTED, [
      { ...CAMPAIGN, currency: 'USD', costPerLeadInr: 12.5 },
    ]);

    await renderAds();

    expect(screen.getByText('$500/day')).toBeTruthy();
    expect(screen.getByText('$1,500')).toBeTruthy();
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it('[PRP-029] says No leads yet when an ad has spent but produced none', async () => {
    mockCampaigns(CONNECTED, [
      { ...CAMPAIGN, leadsInEngine: 0, costPerLeadInr: null },
    ]);

    await renderAds();

    expect(screen.getByText('No leads yet')).toBeTruthy();
  });

  it('[PRP-029] gives an errored ad a sentence-case status and an Archive action', async () => {
    mockCampaigns(CONNECTED, [{ ...CAMPAIGN, status: 'ERROR' }]);

    await renderAds();

    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.queryByText('ERROR')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'More actions for Maple Grove' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pause/ })).toBeNull();
  });

  it("[PRP-029] dates an archived row's frozen figures and withholds its cost per lead", async () => {
    mockCampaigns(CONNECTED, [{ ...CAMPAIGN, status: 'ARCHIVED' }]);

    await renderAds();

    expect(screen.getByText(/^as of /)).toBeTruthy();
    expect(screen.queryByText(/250/)).toBeNull();
    expect(
      screen.getByTitle(/frozen when this ad was archived/).textContent
    ).toBe('—');
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
  });
});

describe('AdsPage actions', () => {
  it('[PRP-029] labels the pause action and hides every action from viewers', async () => {
    mockCampaigns(CONNECTED);
    await renderAds();
    expect(
      screen.getByRole('button', { name: 'Pause ad for Maple Grove' })
    ).toBeTruthy();
    cleanup();

    can.value = false;
    vi.resetModules();
    mockCampaigns(CONNECTED);
    await renderAds();
    expect(screen.queryByRole('button', { name: /^Pause/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^Edit daily budget/ })
    ).toBeNull();
  });

  it('[PRP-029] archives through the overflow menu and an in-app confirmation', async () => {
    const confirmSpy = vi.fn();
    vi.stubGlobal('confirm', confirmSpy);
    const fetchMock = stubFetch((url, init) =>
      init?.method === 'PATCH'
        ? respond({ success: true })
        : respond({ campaigns: [CAMPAIGN], connection: CONNECTED })
    );
    await renderAds();

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Maple Grove' })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Archive ad' })
    );
    await screen.findByText('Archive this ad?');
    fireEvent.click(screen.getByRole('button', { name: 'Archive ad' }));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'PATCH'
      );
      expect(patches).toHaveLength(1);
      expect(JSON.parse(patches[0][1]!.body as string)).toEqual({
        action: 'archive',
      });
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('[PRP-029] saves a budget once when Enter is followed by blur', async () => {
    const fetchMock = stubFetch((url, init) =>
      init?.method === 'PATCH'
        ? respond({ success: true })
        : respond({ campaigns: [CAMPAIGN], connection: CONNECTED })
    );
    await renderAds();

    fireEvent.click(screen.getByRole('button', { name: /^Edit daily budget/ }));
    const input = screen.getByLabelText('Daily budget');
    fireEvent.change(input, { target: { value: '700' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === 'PATCH'
      );
      expect(patches).toHaveLength(1);
      expect(JSON.parse(patches[0][1]!.body as string)).toEqual({
        action: 'set_budget',
        daily_budget_inr: 700,
      });
    });
  });

  it('[PRP-029] cancels a budget edit on Escape without saving', async () => {
    const fetchMock = mockCampaigns(CONNECTED);
    await renderAds();

    fireEvent.click(screen.getByRole('button', { name: /^Edit daily budget/ }));
    const input = screen.getByLabelText('Daily budget');
    fireEvent.change(input, { target: { value: '900' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    expect(screen.queryByLabelText('Daily budget')).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    ).toHaveLength(0);
  });

  it('[PRP-029] shows the server validation message beside the budget input', async () => {
    stubFetch((url, init) =>
      init?.method === 'PATCH'
        ? respond({ error: 'Minimum daily budget is ₹200.' }, false)
        : respond({ campaigns: [CAMPAIGN], connection: CONNECTED })
    );
    await renderAds();

    fireEvent.click(screen.getByRole('button', { name: /^Edit daily budget/ }));
    const input = screen.getByLabelText('Daily budget');
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('Minimum daily budget is ₹200.');
    expect(screen.getByLabelText('Daily budget')).toBeTruthy();
  });
});

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.stubEnv('NEXT_PUBLIC_META_ADS_APP_ID', 'meta-app-test');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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

function mockCampaigns(connectionStatus: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ campaigns: [CAMPAIGN], connectionStatus }),
    })
  );
}

async function renderAds() {
  const { default: AdsPage } = await import('./ads-content');
  render(<AdsPage />);
  await screen.findByText('Maple Grove');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdsPage Meta connection state', () => {
  it('[PRP-029] warns that the Meta connection expired and marks the figures as last sync', async () => {
    mockCampaigns('token_expired');

    await renderAds();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Your Meta connection expired');
    expect(alert.textContent).toContain(
      'Spend, reach and chats below are from the last sync and may be out of date until you reconnect.'
    );
    expect(
      screen.getByRole('link', { name: 'Reconnect Meta' }).getAttribute('href')
    ).toBe('/settings?tab=ads');
    expect(screen.getAllByText('(last sync)')).toHaveLength(4);
    expect(screen.getByText('(stale)')).toBeTruthy();
  });

  it('[PRP-029] shows no expiry warning or stale marks while connected', async () => {
    mockCampaigns('connected');

    await renderAds();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('(last sync)')).toBeNull();
    expect(screen.queryByText('(stale)')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Reconnect Meta' })).toBeNull();
  });
});

describe('AdsPage loading state', () => {
  it('[PRP-038] shows the campaigns table shape while loading, not a splash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { default: AdsPage } = await import('./ads-content');
    render(<AdsPage />);
    const skeleton = screen.getByRole('status', {
      name: 'Loading ad campaigns',
    });
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Property')).toBeTruthy();
    expect(screen.getByText('Cost/lead')).toBeTruthy();
    expect(screen.queryByText(/Loading ad campaigns\.\.\./)).toBeNull();
  });

  it('[PRP-038] swaps the skeleton for the rows once campaigns arrive', async () => {
    mockCampaigns('connected');
    await renderAds();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

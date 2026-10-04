// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MetaAdsTab } from './meta-ads-tab';

const auth = vi.hoisted(() => ({ isOwner: true }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/navigation', () => ({ replaceUrl: vi.fn() }));
vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({ plan: 'pro', isLoading: false }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isOwner: auth.isOwner, profileLoading: false }),
}));

function stubConfig(config: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/config/select')
          ? {
              adAccounts: [{ id: 'act_1', name: 'Main', currency: 'INR' }],
              pages: [{ id: 'p1', name: 'Page', instagramAccountId: null }],
            }
          : config,
    }))
  );
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  auth.isOwner = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MetaAdsTab', () => {
  it('[PRP-041] shows one Reconnect action, not Connect as well, when the token expired', async () => {
    stubConfig({ connected: false, status: 'token_expired' });
    render(<MetaAdsTab />);

    await screen.findByText(/Your Meta connection expired/);

    expect(screen.getAllByRole('button', { name: 'Reconnect' })).toHaveLength(
      1
    );
    expect(
      screen.queryByRole('button', { name: /Connect Meta account/ })
    ).toBeNull();
  });

  it('[PRP-041] lists what happens next above the Connect button for the owner', async () => {
    stubConfig({ connected: false, reason: 'not_connected' });
    render(<MetaAdsTab />);

    await screen.findByText('What happens next');

    expect(
      screen.getByText(
        'Meta will ask for permission to manage ads on your behalf.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Connect Meta account/ })
    ).toBeTruthy();
  });

  it('[PRP-041] hides Connect from non-owners and tells them who can connect', async () => {
    auth.isOwner = false;
    stubConfig({ connected: false, reason: 'not_connected' });
    render(<MetaAdsTab />);

    await screen.findByText('Ask the account owner to connect');

    expect(
      screen.queryByRole('button', { name: /Connect Meta account/ })
    ).toBeNull();
  });

  it('[PRP-041] warns when the connection expires within 14 days', async () => {
    stubConfig({
      connected: true,
      status: 'connected',
      adAccountId: 'act_1',
      pageId: 'p1',
      currency: 'INR',
      tokenExpiresAt: daysFromNow(5),
    });
    render(<MetaAdsTab />);

    await screen.findByText(/Connection expires in [45] days/);
  });

  it('[PRP-041] warns at 13 days 23 hours left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
    stubConfig({
      connected: true,
      status: 'connected',
      adAccountId: 'act_1',
      pageId: 'p1',
      currency: 'INR',
      tokenExpiresAt: '2026-10-17T23:00:00Z',
    });
    render(<MetaAdsTab />);

    await screen.findByText('Connection expires in 14 days');
  });

  it('[PRP-041] stays quiet at exactly 14 days left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
    stubConfig({
      connected: true,
      status: 'connected',
      adAccountId: 'act_1',
      pageId: 'p1',
      currency: 'INR',
      tokenExpiresAt: '2026-10-18T00:00:00Z',
    });
    render(<MetaAdsTab />);

    await screen.findByText('Connected');

    expect(screen.queryByText(/Connection expires/)).toBeNull();
  });

  it('[PRP-041] stays quiet when the connection has more than 14 days left', async () => {
    stubConfig({
      connected: true,
      status: 'connected',
      adAccountId: 'act_1',
      pageId: 'p1',
      currency: 'INR',
      tokenExpiresAt: daysFromNow(40),
    });
    render(<MetaAdsTab />);

    await screen.findByText('Connected');

    expect(screen.queryByText(/Connection expires/)).toBeNull();
  });

  it('[PRP-041] offers Reconnect and Disconnect while the ad account is still to be chosen, with labelled selects', async () => {
    stubConfig({
      connected: true,
      status: 'connected',
      needsAssetSelection: true,
    });
    render(<MetaAdsTab />);

    const adAccount = await screen.findByLabelText('Ad account');
    expect(adAccount.tagName).toBe('SELECT');
    expect(screen.getByLabelText('Facebook Page').tagName).toBe('SELECT');
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('[PRP-041] re-enables Connect when the window regains focus', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      assign,
      origin: 'http://localhost',
    });
    stubConfig({ connected: false, reason: 'not_connected' });
    render(<MetaAdsTab />);

    const button = await screen.findByRole('button', {
      name: /Connect Meta account/,
    });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent(window, new Event('focus'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

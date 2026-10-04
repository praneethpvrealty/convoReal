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
import { PortalDriftPanel } from './portal-drift-panel';
import type { PortalDriftFinding } from '@/app/api/portals/drift/route';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-portal-drift' }),
}));

const KEY_PREFIX = 'convoreal.portalDrift.dismissed:v1';
const ACCOUNT_ID = 'acct-portal-drift';
const KEY = `${KEY_PREFIX}:${ACCOUNT_ID}`;

const BASE_FINDING: PortalDriftFinding = {
  portal: 'magicbricks',
  portalListingId: 'pb-101',
  listingUrl: 'https://example.com/magicbricks/pb-101',
  expiresOn: '2026-11-20',
  propertyId: 'prop-101',
  propertyTitle: 'Maple Grove',
  propertyCode: 'MB-101',
  propertyStatus: 'withdrawn',
  driftKind: 'withdrawn_stock',
  leadCount: 12,
  lastLeadAt: '2026-11-22T10:00:00Z',
  parsedPropertyType: 'Apartment',
  parsedPrice: 72000000,
  parsedAreaSqft: 1234,
  listingType: 'sell',
  listingPrice: 72000000,
  listingAreaSqft: 1234,
};

function findingSignature(finding: PortalDriftFinding) {
  return `${finding.portal}|${finding.portalListingId}|${finding.propertyId}|${finding.driftKind}|${finding.propertyStatus ?? ''}`;
}

function mockDriftFetch(responses: PortalDriftFinding[][]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: response }),
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PortalDriftPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('PortalDriftPanel', () => {
  it('shows the discrepancy banner when findings exist', async () => {
    mockDriftFetch([[BASE_FINDING]]);

    renderPanel();

    expect(
      await screen.findByText(/1 portal ad doesn.t match your listings/)
    ).toBeTruthy();
    expect(screen.queryByText('Ad live on withdrawn stock')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText('Ad live on withdrawn stock')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByText('Ad live on withdrawn stock')).toBeNull();
  });

  it('shows only the fields that actually disagree', async () => {
    mockDriftFetch([
      [
        {
          ...BASE_FINDING,
          driftKind: 'details_drift',
          parsedPropertyType: null,
          listingType: null,
          parsedPrice: null,
          listingPrice: null,
          parsedAreaSqft: 3000,
          listingAreaSqft: 2400,
        },
      ],
    ]);

    renderPanel();

    await screen.findByText(/1 portal ad doesn.t match your listings/);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText('Ad and listing disagree')).toBeTruthy();
    expect(screen.getByText(/3000 vs 2400 sq ft/)).toBeTruthy();
    expect(screen.queryByText(/Apartment vs/)).toBeNull();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it('hides and persists a signature-specific dismissal', async () => {
    mockDriftFetch([[BASE_FINDING]]);

    renderPanel();
    expect(
      await screen.findByText(/1 portal ad doesn.t match your listings/)
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss portal discrepancy banner'));

    await waitFor(() =>
      expect(
        screen.queryByText(/1 portal ad doesn.t match your listings/)
      ).toBeNull()
    );
    expect(localStorage.getItem(KEY)).toBe(findingSignature(BASE_FINDING));
  });

  it('shows the banner when saved signature no longer matches current findings', async () => {
    localStorage.setItem(KEY, 'stale-signature');
    mockDriftFetch([[BASE_FINDING]]);

    renderPanel();
    expect(
      await screen.findByText(/1 portal ad doesn.t match your listings/)
    ).toBeTruthy();
    await waitFor(() => {
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  it('keeps the banner hidden while signatures match across mounts', async () => {
    mockDriftFetch([[BASE_FINDING], [BASE_FINDING]]);

    const first = renderPanel();
    expect(
      await first.findByText(/1 portal ad doesn.t match your listings/)
    ).toBeTruthy();
    fireEvent.click(first.getByLabelText('Dismiss portal discrepancy banner'));
    await waitFor(() =>
      expect(
        first.queryByText(/1 portal ad doesn.t match your listings/)
      ).toBeNull()
    );
    first.unmount();

    renderPanel();
    expect(
      screen.queryByText(/1 portal ad doesn.t match your listings/)
    ).toBeNull();
  });

  it('[PRP-028] explains the findings only after the panel is expanded', async () => {
    mockDriftFetch([[BASE_FINDING]]);

    renderPanel();

    expect(
      await screen.findByText(/1 portal ad doesn.t match your listings/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /review/i })).toBeTruthy();
    expect(screen.queryByText(/Spotted from the leads and emails/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText(/Spotted from the leads and emails/)).toBeTruthy();
  });

  it('[PRP-028] links each finding to the portal listing editor and the listing', async () => {
    const second: PortalDriftFinding = {
      ...BASE_FINDING,
      portalListingId: 'pb-202',
      propertyId: 'prop/202 x',
    };
    mockDriftFetch([[BASE_FINDING, second]]);

    renderPanel();

    await screen.findByText(/2 portal ads don.t match your listings/);
    fireEvent.click(screen.getByRole('button', { name: /review/i }));

    const updateLinks = screen.getAllByRole('link', {
      name: 'Update portal listing',
    });
    const openLinks = screen.getAllByRole('link', { name: 'Open listing' });
    expect(updateLinks.map((a) => a.getAttribute('href'))).toEqual([
      `/inventory?portalPropertyId=${encodeURIComponent(BASE_FINDING.propertyId)}`,
      `/inventory?portalPropertyId=${encodeURIComponent(second.propertyId)}`,
    ]);
    expect(openLinks.map((a) => a.getAttribute('href'))).toEqual([
      `/inventory?propertyId=${encodeURIComponent(BASE_FINDING.propertyId)}`,
      `/inventory?propertyId=${encodeURIComponent(second.propertyId)}`,
    ]);
    expect(screen.getAllByRole('link', { name: /View ad/ })).toHaveLength(2);
  });

  it('[PRP-028] pluralises the headline for several findings', async () => {
    mockDriftFetch([
      [BASE_FINDING, { ...BASE_FINDING, portalListingId: 'pb-303' }],
    ]);

    renderPanel();

    expect(
      await screen.findByText("2 portal ads don't match your listings")
    ).toBeTruthy();
  });
});

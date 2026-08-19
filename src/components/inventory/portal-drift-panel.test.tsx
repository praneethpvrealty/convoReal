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

vi.mock('@/hooks/use-auth', () => ({
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

    expect(await screen.findByText(/1 portal ad out of step with your inventory/)).toBeTruthy();
    expect(screen.getByText('Ad live on withdrawn stock')).toBeTruthy();
  });

  it('hides and persists a signature-specific dismissal', async () => {
    mockDriftFetch([[BASE_FINDING]]);

    renderPanel();
    expect(await screen.findByText(/1 portal ad out of step with your inventory/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss portal discrepancy banner'));

    await waitFor(() =>
      expect(screen.queryByText(/1 portal ad out of step with your inventory/)).toBeNull()
    );
    expect(localStorage.getItem(KEY)).toBe(findingSignature(BASE_FINDING));
  });

  it('shows the banner when saved signature no longer matches current findings', async () => {
    localStorage.setItem(KEY, 'stale-signature');
    mockDriftFetch([[BASE_FINDING]]);

    renderPanel();
    expect(await screen.findByText(/1 portal ad out of step with your inventory/)).toBeTruthy();
    await waitFor(() => {
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  it('keeps the banner hidden while signatures match across mounts', async () => {
    mockDriftFetch([[BASE_FINDING], [BASE_FINDING]]);

    const first = renderPanel();
    expect(await first.findByText(/1 portal ad out of step with your inventory/)).toBeTruthy();
    fireEvent.click(first.getByLabelText('Dismiss portal discrepancy banner'));
    await waitFor(() =>
      expect(first.queryByText(/1 portal ad out of step with your inventory/)).toBeNull()
    );
    first.unmount();

    renderPanel();
    expect(screen.queryByText(/1 portal ad out of step with your inventory/)).toBeNull();
  });
});


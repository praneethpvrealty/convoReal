// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PortalDriftPanel } from './portal-drift-panel';
import type { PortalDriftFinding } from '@/app/api/portals/drift/route';

const BASE_FINDING: PortalDriftFinding = {
  portal: 'magicbricks',
  portalListingId: 'MB-99',
  listingUrl: 'https://example.com/listing',
  expiresOn: '2026-01-01',
  propertyId: 'prop-1',
  propertyTitle: 'Test villa',
  propertyCode: 'V-1',
  propertyStatus: 'Active',
  driftKind: 'withdrawn_stock',
  leadCount: 2,
  lastLeadAt: '2026-01-01T00:00:00Z',
  parsedPropertyType: 'Villa',
  parsedPrice: 8500000,
  parsedAreaSqft: 2000,
  listingType: 'sell',
  listingPrice: 8500000,
  listingAreaSqft: 2000,
};

function setDriftResponses(...responses: Array<PortalDriftFinding[]>) {
  const fetchMock = vi.fn();

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: response }),
    });
  }

  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] }),
  });

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('PortalDriftPanel', () => {
  it('lets the banner be dismissed and keeps it hidden while the same mismatch exists', async () => {
    setDriftResponses([BASE_FINDING], [BASE_FINDING]);

    renderPanel();
    expect(await screen.findByText(/1 portal ad out of step/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss portal drift alert/i }));
    expect(screen.queryByText(/1 portal ad out of step/i)).toBeNull();

    cleanup();
    renderPanel();
    expect(screen.queryByText(/1 portal ad out of step/i)).toBeNull();
  });

  it('shows the banner again if the underlying drift details change materially', async () => {
    const updatedFinding: PortalDriftFinding = {
      ...BASE_FINDING,
      driftKind: 'likely_lapsed',
      propertyStatus: 'Inactive',
      leadCount: 5,
    };

    setDriftResponses([BASE_FINDING], [updatedFinding]);

    renderPanel();
    expect(await screen.findByText(/1 portal ad out of step/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss portal drift alert/i }));
    expect(screen.queryByText(/1 portal ad out of step/i)).toBeNull();

    cleanup();
    renderPanel();
    expect(await screen.findByText(/1 portal ad out of step/i)).toBeTruthy();
  });
});

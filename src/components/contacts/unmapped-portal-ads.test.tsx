// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { UnmappedPortalAds } from './unmapped-portal-ads';

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: toasts }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('[PRP-008] accepts the guessed property without reopening the picker', async () => {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                portal: 'magicbricks',
                portalListingId: '85514527',
                leadCount: 11,
                lastSeenAt: '2026-09-18T00:00:00.000Z',
                sampleContactId: 'contact-1',
                sampleContactName: null,
                guessedPropertyId: 'property-2400',
                guessedPropertyTitle:
                  '2400 sqft Residential Plot in Surya City Phase 2',
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          data: {
            propertyTitle: '2400 sqft Residential Plot in Surya City Phase 2',
            taggedContacts: 11,
          },
        }),
      };
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  const onMapped = vi.fn();

  render(<UnmappedPortalAds onMapped={onMapped} />);

  fireEvent.click(
    await screen.findByRole('button', {
      name: /Accept 2400 sqft Residential Plot in Surya City Phase 2/,
    })
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const [url, init] = fetchMock.mock.calls[1];
  expect(url).toBe('/api/contacts/contact-1/portal-link');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({
    propertyId: 'property-2400',
  });
  await waitFor(() => expect(onMapped).toHaveBeenCalledOnce());
  expect(screen.queryByText(/magicbricks ad 85514527/)).toBeNull();
  expect(toasts.success).toHaveBeenCalled();
});

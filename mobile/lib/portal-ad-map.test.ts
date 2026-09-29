import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
  isTimeout: (e: unknown) => (e as { status?: number })?.status === 408,
}));

const { apiFetch } = await import('./api');
const { mapPortalAd, PORTAL_LINK_TIMEOUT_MS } = await import('./portal-ad-map');

const fetchMock = vi.mocked(apiFetch);
const ok = { data: { propertyTitle: 'Basil', taggedContacts: 2 } };

describe('mapPortalAd', () => {
  beforeEach(() => fetchMock.mockReset());

  it('posts the listing with the longer budget', async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await expect(mapPortalAd('c1', 'p1')).resolves.toEqual(ok.data);
    expect(fetchMock).toHaveBeenCalledWith('/api/contacts/c1/portal-link', {
      method: 'POST',
      body: JSON.stringify({ propertyId: 'p1' }),
      timeoutMs: PORTAL_LINK_TIMEOUT_MS,
    });
    expect(PORTAL_LINK_TIMEOUT_MS).toBeGreaterThan(20_000);
  });

  it('asks once more when the first request was abandoned', async () => {
    fetchMock.mockRejectedValueOnce({ status: 408 }).mockResolvedValueOnce(ok);
    await expect(mapPortalAd('c1', 'p1')).resolves.toEqual(ok.data);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a refusal the server returned', async () => {
    fetchMock.mockRejectedValueOnce({ status: 409 });
    await expect(mapPortalAd('c1', 'p1')).rejects.toEqual({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries at most once', async () => {
    fetchMock
      .mockRejectedValueOnce({ status: 408 })
      .mockRejectedValueOnce({ status: 408 });
    await expect(mapPortalAd('c1', 'p1')).rejects.toEqual({ status: 408 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

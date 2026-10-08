// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ShareGrantTtlKey } from '@/lib/inventory/share-grants';
import { useShareLinkGrant } from './useShareLinkGrant';

interface Props {
  open: boolean;
  revealLocation: boolean;
  ttl: ShareGrantTtlKey;
}

const fetchMock = vi.fn();
let minted = 0;

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function calls(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init?.method ?? 'GET') === method
  );
}

function render(initial: Props) {
  const onGrantsChanged = vi.fn();
  const hook = renderHook(
    (props: Props) =>
      useShareLinkGrant({
        open: props.open,
        propertyId: 'p1',
        revealLocation: props.revealLocation,
        revealDocuments: false,
        revealPrivateImages: false,
        ttl: props.ttl,
        onGrantsChanged,
      }),
    { initialProps: initial }
  );
  return { ...hook, onGrantsChanged };
}

beforeEach(() => {
  minted = 0;
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      minted += 1;
      return respond({ data: { id: `g${minted}`, token: `tok${minted}` } });
    }
    return respond({ data: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('[PRP-043] useShareLinkGrant', () => {
  it('mints nothing when an unmask switch is turned on', async () => {
    const { rerender } = render({
      open: true,
      revealLocation: false,
      ttl: '7d',
    });
    rerender({ open: true, revealLocation: true, ttl: '7d' });
    rerender({ open: true, revealLocation: true, ttl: '30d' });
    rerender({ open: true, revealLocation: false, ttl: '30d' });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mints one key on first send and reuses it', async () => {
    const { result } = render({ open: true, revealLocation: true, ttl: '7d' });
    let tokens: (string | null)[] = [];
    await act(async () => {
      tokens = await Promise.all([
        result.current.ensureLinkGrant(),
        result.current.ensureLinkGrant(),
      ]);
    });
    expect(tokens).toEqual(['tok1', 'tok1']);
    await act(async () => {
      tokens = [await result.current.ensureLinkGrant()];
    });
    expect(tokens).toEqual(['tok1']);
    expect(calls('POST')).toHaveLength(1);
    expect(JSON.parse(calls('POST')[0][1].body)).toMatchObject({
      contact_id: null,
      reveal_location: true,
      expires_in: '7d',
    });
    await waitFor(() =>
      expect(result.current.linkGrant).toEqual({ id: 'g1', token: 'tok1' })
    );
  });

  it('returns no key and makes no request while the share is masked', async () => {
    const { result } = render({
      open: true,
      revealLocation: false,
      ttl: '7d',
    });
    let token: string | null = 'unset';
    await act(async () => {
      token = await result.current.ensureLinkGrant();
    });
    expect(token).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revokes a minted key when what it reveals changes', async () => {
    const { result, rerender } = render({
      open: true,
      revealLocation: true,
      ttl: '7d',
    });
    await act(async () => {
      await result.current.ensureLinkGrant();
    });
    rerender({ open: true, revealLocation: true, ttl: '24h' });
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(calls('DELETE')[0][0]).toContain('grant_id=g1');
    await waitFor(() => expect(result.current.linkGrant).toBeNull());
  });

  it('keeps a sent key live when the dialog closes', async () => {
    const { result, rerender } = render({
      open: true,
      revealLocation: true,
      ttl: '7d',
    });
    await act(async () => {
      await result.current.ensureLinkGrant();
    });
    rerender({ open: false, revealLocation: true, ttl: '7d' });
    rerender({ open: false, revealLocation: false, ttl: '7d' });
    await act(async () => {});
    expect(calls('DELETE')).toHaveLength(0);
  });

  it('rejects and revokes a key whose mint outlives the dialog', async () => {
    let finishMint: (value: unknown) => void = () => {};
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise((resolve) => {
          finishMint = resolve;
        });
      }
      return respond({ data: null });
    });
    const { result, rerender } = render({
      open: true,
      revealLocation: true,
      ttl: '7d',
    });
    let pending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.ensureLinkGrant();
    });
    rerender({ open: false, revealLocation: true, ttl: '7d' });
    await act(async () => {
      finishMint({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'g5', token: 'tok5' } }),
      });
      await expect(pending).rejects.toThrow('cancelled');
    });
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(calls('DELETE')[0][0]).toContain('grant_id=g5');
  });

  it('falls back to the share-wide key when a contact key fails', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return respond({ data: null });
      const body = JSON.parse(String(init.body));
      if (body.contact_id) return respond({ error: 'nope' }, false);
      return respond({ data: { id: 'g9', token: 'tok9' } });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = render({ open: true, revealLocation: true, ttl: '7d' });
    let token: string | null = null;
    await act(async () => {
      token = await result.current.ensureContactGrant('c1');
    });
    expect(token).toBe('tok9');
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Deferred = {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
};

function deferred(): Deferred {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const pending: Deferred[] = [];

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === 'POST') {
    const d = deferred();
    pending.push(d);
    return d.promise;
  }
  const id = new URL(url).searchParams.get('property_id');
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: { own: false, canImport: true, importedId: null, id },
      }),
  } as unknown as Response);
});
vi.stubGlobal('fetch', fetchMock);
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { AddToInventory } from './add-to-inventory';

function renderControl(propertyId: string, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <AddToInventory
        propertyId={propertyId}
        signedOut={false}
        onSignedOut={() => {}}
      />
    </QueryClientProvider>
  );
}

const addButton = () =>
  screen.queryByRole('button', {
    name: /add this property to your inventory/i,
  });

beforeEach(() => {
  pending.length = 0;
  fetchMock.mockClear();
});

afterEach(() => cleanup());

describe('AddToInventory', () => {
  it('[PRP-053] credits a finished import to the listing it started on, not the one now open', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderControl('prop-a', client);
    await waitFor(() => expect(addButton()).toBeTruthy());

    fireEvent.click(addButton()!);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      property_id: 'prop-a',
    });

    view.rerender(
      <QueryClientProvider client={client}>
        <AddToInventory
          propertyId="prop-b"
          signedOut={false}
          onSignedOut={() => {}}
        />
      </QueryClientProvider>
    );
    await waitFor(() => expect(addButton()).toBeTruthy());
    expect(addButton()!.hasAttribute('disabled')).toBe(false);

    pending[0].resolve({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ data: { id: 'copy-a' } }),
    } as unknown as Response);
    await waitFor(() =>
      expect(client.getQueryData(['showcase-import', 'prop-a'])).toMatchObject({
        viewer: { importedId: 'copy-a' },
      })
    );
    expect(addButton()).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: /in your inventory/i })
    ).toBeNull();

    view.rerender(
      <QueryClientProvider client={client}>
        <AddToInventory
          propertyId="prop-a"
          signedOut={false}
          onSignedOut={() => {}}
        />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('link', { name: /in your inventory/i })
          .getAttribute('href')
      ).toBe('https://www.convoreal.com/inventory?propertyId=copy-a')
    );
  });
});

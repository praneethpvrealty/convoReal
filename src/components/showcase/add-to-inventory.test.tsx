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
const probeStatus = { value: 200 };

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === 'POST') {
    const d = deferred();
    pending.push(d);
    return d.promise;
  }
  const ids = (new URL(url).searchParams.get('property_ids') ?? '')
    .split(',')
    .filter(Boolean);
  return Promise.resolve({
    ok: probeStatus.value < 400,
    status: probeStatus.value,
    json: () =>
      Promise.resolve({
        data: {
          viewers: Object.fromEntries(
            ids.map((id) => [
              id,
              { own: false, canImport: true, importedId: null },
            ])
          ),
        },
      }),
  } as unknown as Response);
});
vi.stubGlobal('fetch', fetchMock);
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  AddToInventory,
  useShowcaseImportViewers,
  VIEWER_BATCH_SIZE,
} from './add-to-inventory';

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
  probeStatus.value = 200;
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

  it('[PRP-053] splits a large catalog into probes of at most the route\u2019s limit', async () => {
    const ids = Array.from(
      { length: VIEWER_BATCH_SIZE + 5 },
      (_, i) => `prop-${String(i).padStart(3, '0')}`
    );
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Catalog ids={ids} />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(client.getQueryData(['showcase-import', ids.at(-1)])).toEqual({
        signedOut: false,
        viewer: { own: false, canImport: true, importedId: null },
      })
    );
    const sizes = fetchMock.mock.calls.map(
      ([input]) =>
        (new URL(String(input)).searchParams.get('property_ids') ?? '').split(
          ','
        ).length
    );
    expect(sizes).toEqual([VIEWER_BATCH_SIZE, 5]);
  });

  it('[PRP-053] stops at the first answer that says the visitor is signed out', async () => {
    probeStatus.value = 401;
    const ids = Array.from(
      { length: VIEWER_BATCH_SIZE * 2 },
      (_, i) => `prop-${String(i).padStart(3, '0')}`
    );
    const onSignedOut = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Catalog ids={ids} onSignedOut={onSignedOut} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function Catalog({
  ids,
  onSignedOut = () => {},
}: {
  ids: string[];
  onSignedOut?: () => void;
}) {
  useShowcaseImportViewers(ids, false, onSignedOut);
  return null;
}

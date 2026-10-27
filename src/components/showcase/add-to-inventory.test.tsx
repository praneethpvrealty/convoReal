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
const probeStatus = {
  value: 200,
  failShortBatch: false,
  failingFirstIds: [] as string[],
  unreadableFirstIds: [] as string[],
};

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
  const status =
    (probeStatus.failShortBatch && ids.length < VIEWER_BATCH_SIZE) ||
    probeStatus.failingFirstIds.includes(ids[0])
      ? 500
      : probeStatus.value;
  if (probeStatus.unreadableFirstIds.includes(ids[0])) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response);
  }
  return Promise.resolve({
    ok: status < 400,
    status,
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
  probeStatus.failShortBatch = false;
  probeStatus.failingFirstIds = [];
  probeStatus.unreadableFirstIds = [];
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

  it('[PRP-053] keeps each listing\u2019s answer while no card shows it, so a card that comes back still offers the control', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <Catalog ids={['prop-a', 'prop-b']} />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(client.getQueryData(['showcase-import', 'prop-b'])).toBeTruthy()
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(
      <QueryClientProvider client={client}>
        <Catalog ids={['prop-a', 'prop-b']} />
        <AddToInventory
          propertyId="prop-b"
          title="Whitefield Apartment"
          variant="icon"
          probe={false}
          signedOut={false}
          onSignedOut={() => {}}
        />
      </QueryClientProvider>
    );
    expect(
      screen.getByRole('button', {
        name: 'Add Whitefield Apartment to my inventory',
      })
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('[PRP-053] keeps the listings a batch answered when a later batch fails', async () => {
    probeStatus.failShortBatch = true;
    const ids = Array.from(
      { length: VIEWER_BATCH_SIZE + 5 },
      (_, i) => `prop-${String(i).padStart(3, '0')}`
    );
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Catalog ids={ids} />
        <AddToInventory
          propertyId={ids[0]}
          title="First listing"
          variant="icon"
          probe={false}
          signedOut={false}
          onSignedOut={() => {}}
        />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'Add First listing to my inventory',
        })
      ).toBeTruthy()
    );
    expect(
      client.getQueryData(['showcase-import', ids.at(-1)])
    ).toBeUndefined();
  });

  it('[PRP-053] asks the batches after a failed one, and retries only the listings still unanswered', async () => {
    const ids = Array.from(
      { length: VIEWER_BATCH_SIZE * 2 + 5 },
      (_, i) => `prop-${String(i).padStart(3, '0')}`
    );
    probeStatus.failingFirstIds = [ids[VIEWER_BATCH_SIZE]];
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Catalog ids={ids} />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(client.getQueryData(['showcase-import', ids.at(-1)])).toBeTruthy()
    );
    expect(client.getQueryData(['showcase-import', ids[0]])).toBeTruthy();
    expect(
      client.getQueryData(['showcase-import', ids[VIEWER_BATCH_SIZE]])
    ).toBeUndefined();

    probeStatus.failingFirstIds = [];
    await waitFor(
      () =>
        expect(
          client.getQueryData(['showcase-import', ids[VIEWER_BATCH_SIZE]])
        ).toBeTruthy(),
      { timeout: 3000 }
    );
    const retried = fetchMock.mock.calls
      .slice(3)
      .map(([input]) =>
        (new URL(String(input)).searchParams.get('property_ids') ?? '').split(
          ','
        )
      );
    expect(retried).toEqual([
      ids.slice(VIEWER_BATCH_SIZE, VIEWER_BATCH_SIZE * 2),
    ]);
  });

  it('[PRP-053] treats a batch whose answer cannot be read as failed, and still asks the rest', async () => {
    const ids = Array.from(
      { length: VIEWER_BATCH_SIZE + 5 },
      (_, i) => `prop-${String(i).padStart(3, '0')}`
    );
    probeStatus.unreadableFirstIds = [ids[0]];
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Catalog ids={ids} />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(client.getQueryData(['showcase-import', ids.at(-1)])).toBeTruthy()
    );
    expect(client.getQueryData(['showcase-import', ids[0]])).toBeUndefined();
  });

  it('[PRP-053] reports the page as offering imports from the batches that answered, even when another keeps failing', async () => {
    probeStatus.failShortBatch = true;
    const ids = Array.from(
      { length: VIEWER_BATCH_SIZE + 5 },
      (_, i) => `prop-${String(i).padStart(3, '0')}`
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OffersImport ids={ids} />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('offers').textContent).toBe('offers')
    );
  });

  it('[PRP-053] reports no import offer for a signed-out visitor', async () => {
    probeStatus.value = 401;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OffersImport ids={['prop-a']} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('offers').textContent).toBe('none');
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

function OffersImport({ ids }: { ids: string[] }) {
  const { offersImport } = useShowcaseImportViewers(ids, false, () => {});
  return <span data-testid="offers">{offersImport ? 'offers' : 'none'}</span>;
}

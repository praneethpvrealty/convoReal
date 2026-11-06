// @vitest-environment happy-dom

import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import EditAutomationPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/components/automations/automation-builder', () => ({
  AutomationBuilder: ({ initial }: { initial: { name: string } }) => (
    <p>Builder for {initial.name}</p>
  ),
  fromServerSteps: () => [],
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPage() {
  const client = new QueryClient();
  const params = Promise.resolve({ id: 'a1' });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={null}>
          <EditAutomationPage params={params} />
        </Suspense>
      </QueryClientProvider>
    );
  });
}

describe('[UIX-053] automation edit page', () => {
  it('shows a retry instead of spinning forever when the load fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('this automation');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          automation: {
            id: 'a1',
            name: 'Welcome',
            trigger_type: 'new_message_received',
          },
          steps: [],
        }),
        { status: 200 }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Builder for Welcome')).toBeTruthy();
  });

  it('says the automation is gone on a 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await renderPage();
    expect(
      await screen.findByText('This automation no longer exists.')
    ).toBeTruthy();
  });
});

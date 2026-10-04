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
import type { MessageTemplate } from '@/types';
import { Step4ScheduleSend } from './step4-schedule-send';

const TEMPLATE = {
  id: 't1',
  name: 'summer_offer',
  language: 'en_US',
} as unknown as MessageTemplate;

const fetchMock = vi.fn();

function countResponse(count: number) {
  return new Response(JSON.stringify({ data: { count } }), { status: 200 });
}

function failedResponse() {
  return new Response(JSON.stringify({ error: 'Failed to count' }), {
    status: 500,
  });
}

function renderStep(onSend = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Step4ScheduleSend
        name="Summer"
        onNameChange={() => {}}
        template={TEMPLATE}
        audience={{ type: 'all' }}
        onSend={onSend}
        onBack={() => {}}
        isProcessing={false}
        progress={0}
      />
    </QueryClientProvider>
  );
  return onSend;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Step4ScheduleSend confirm dialog', () => {
  it('sends to the freshly recounted audience', async () => {
    fetchMock
      .mockResolvedValueOnce(countResponse(5))
      .mockResolvedValueOnce(countResponse(7));
    const onSend = renderStep();

    await screen.findByText('5');
    fireEvent.click(screen.getByRole('button', { name: /Send Broadcast/ }));

    const send = await screen.findByRole('button', {
      name: 'Send to 7 contacts',
    });
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('keeps sending disabled when the recount fails, until a retry succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(countResponse(5))
      .mockResolvedValueOnce(failedResponse())
      .mockResolvedValueOnce(countResponse(6));
    const onSend = renderStep();

    await screen.findByText('5');
    fireEvent.click(screen.getByRole('button', { name: /Send Broadcast/ }));

    await screen.findByRole('alert');
    expect(
      screen.queryByRole('button', { name: /Send to 5 contacts/ })
    ).toBeNull();
    expect(screen.getByText('…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Retry count/ }));
    const send = await screen.findByRole('button', {
      name: 'Send to 6 contacts',
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

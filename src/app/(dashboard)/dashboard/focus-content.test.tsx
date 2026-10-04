// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FocusContent from './focus-content';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('@/components/journey/journey-embed', () => ({
  JourneyEmbed: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Focus tab loading', () => {
  it('renders the heading at once and a skeleton only in the body while loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined))
    );

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FocusContent />
      </QueryClientProvider>
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Focus' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading Focus' })).toBeTruthy();
  });
});

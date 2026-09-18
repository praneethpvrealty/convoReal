// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { AskPropertyChat } from './ask-property-chat';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ask property chat', () => {
  it('does not throw scrolling the thread when the element has no scrollTo', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ answer: 'Yes, it is negotiable.' }),
        })
      )
    );

    render(
      <AskPropertyChat accountId="acct-1" propertyId="prop-1" propertyTitle="Test Villa" />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /is the price negotiable/i })
    );

    await screen.findByText(/yes, it is negotiable/i);

    // Some environments (older WebViews, crawlers) attach the ref to an
    // element with no `scrollTo` method — the bug reported in Sentry as
    // "threadRef.current?.scrollTo is not a function".
    delete (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo;

    expect(() => {
      rafCallbacks.forEach((cb) => cb(0));
    }).not.toThrow();
  });
});

// @vitest-environment happy-dom

import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const prefetch = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch }),
}));

vi.mock('next/link', () => ({
  default: ({
    prefetch: linkPrefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a data-prefetch={String(linkPrefetch)} {...rest} />
  ),
}));

const { IntentPrefetchLink } = await import('./intent-prefetch-link');

describe('[ACC-011] sidebar links prefetch on intent', () => {
  afterEach(() => {
    cleanup();
    prefetch.mockReset();
  });

  it('does not prefetch until the pointer, focus or a touch reaches the link, then prefetches once', () => {
    render(<IntentPrefetchLink href="/contacts">Contacts</IntentPrefetchLink>);
    const link = screen.getByText('Contacts');
    expect(link.getAttribute('data-prefetch')).toBe('false');
    expect(prefetch).not.toHaveBeenCalled();

    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith('/contacts');
  });

  it('prefetches again once the earlier prefetch is 30 seconds old, and keeps the caller handlers', () => {
    vi.useFakeTimers();
    const onFocus = vi.fn();
    render(
      <IntentPrefetchLink href="/inventory" onFocus={onFocus}>
        Inventory
      </IntentPrefetchLink>
    );
    const link = screen.getByText('Inventory');
    fireEvent.focus(link);
    expect(onFocus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_000);
    fireEvent.pointerEnter(link);
    expect(prefetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    fireEvent.pointerEnter(link);
    expect(prefetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

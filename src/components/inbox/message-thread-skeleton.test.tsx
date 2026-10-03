// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MessageThreadSkeleton } from '@/components/inbox/message-thread-skeleton';

afterEach(cleanup);

describe('MessageThreadSkeleton', () => {
  it('renders placeholder bubbles on both sides as one busy status', () => {
    render(<MessageThreadSkeleton />);

    const status = screen.getByRole('status', { name: 'Loading messages' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    const bubbles = screen.getAllByTestId('message-skeleton-bubble');
    expect(bubbles.length).toBeGreaterThanOrEqual(4);
    expect(bubbles.some((b) => b.className.includes('justify-end'))).toBe(true);
    expect(bubbles.some((b) => b.className.includes('justify-start'))).toBe(
      true
    );
    expect(screen.queryByText(/Loading messages/)).toBeNull();
  });
});

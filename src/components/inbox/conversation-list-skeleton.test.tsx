// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

// ============================================================
// The inbox list's loading state. It used to be a centred logo splash
// that swapped to the list in one jump; it is now rows shaped like the
// conversations about to appear, so the column keeps its layout while
// the first fetch runs, and assistive tech hears one busy status.
// ============================================================

import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import {
  ConversationListSkeleton,
  CONVERSATION_SKELETON_ROWS,
} from '@/components/inbox/conversation-list-skeleton';

afterEach(cleanup);

describe('ConversationListSkeleton', () => {
  it('renders a full column of placeholder rows as one busy status', () => {
    render(<ConversationListSkeleton />);

    const status = screen.getByRole('status', {
      name: 'Loading conversations',
    });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByTestId('conversation-skeleton-row')).toHaveLength(
      CONVERSATION_SKELETON_ROWS
    );
    expect(screen.queryByText(/Loading conversations/)).toBeNull();
  });
});

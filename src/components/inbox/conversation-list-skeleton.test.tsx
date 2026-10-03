// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

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

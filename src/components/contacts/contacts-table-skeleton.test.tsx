// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true } }

import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import {
  ContactsTableSkeleton,
  CONTACTS_SKELETON_ROWS,
} from '@/components/contacts/contacts-table-skeleton';

afterEach(cleanup);

describe('ContactsTableSkeleton', () => {
  it('renders a page of placeholder rows as one busy status', () => {
    render(<ContactsTableSkeleton />);

    const status = screen.getByRole('status', { name: 'Loading contacts' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByTestId('contacts-skeleton-row')).toHaveLength(
      CONTACTS_SKELETON_ROWS
    );
    expect(screen.queryByText(/Loading contacts/)).toBeNull();
  });
});

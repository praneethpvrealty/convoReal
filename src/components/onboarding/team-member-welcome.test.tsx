// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TeamMemberWelcome } from './team-member-welcome';

const props = {
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
};
const storageKey = 'team_member_welcome_seen_account-1_user-1';

describe('TeamMemberWelcome', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    localStorage.clear();
  });

  it('introduces invited team members to their operational workflow', () => {
    render(<TeamMemberWelcome {...props} />);

    expect(screen.getByText('Welcome to your team workspace')).toBeTruthy();
    expect(screen.getByText('Contacts and requirements')).toBeTruthy();
    expect(screen.getByText('Inventory and sharing')).toBeTruthy();
    expect(screen.getByText('Visits and follow-up')).toBeTruthy();
    expect(screen.getByText('Read the quick-start PDF')).toBeTruthy();
  });

  it('persists dismissal for that user and workspace', () => {
    render(<TeamMemberWelcome {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Go to workspace' }));

    expect(localStorage.getItem(storageKey)).toBe('true');
    expect(screen.queryByText('Welcome to your team workspace')).toBeNull();
  });

  it('stays hidden after it has already been seen', () => {
    localStorage.setItem(storageKey, 'true');

    render(<TeamMemberWelcome {...props} />);

    expect(screen.queryByText('Welcome to your team workspace')).toBeNull();
  });
});

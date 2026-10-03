// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { ActivityItem } from '@/lib/dashboard/types';
import { ActivityFeed } from './activity-feed';

afterEach(cleanup);

const AT = new Date().toISOString();

describe('ActivityFeed', () => {
  it('flags a failed automation in red and links to that automation', () => {
    const items: ActivityItem[] = [
      {
        id: 'auto-1',
        kind: 'automation',
        text: 'Automation "initial" failed for Praneeth',
        at: AT,
        href: '/automations/auto-uuid/logs',
        failed: true,
      },
    ];
    render(<ActivityFeed items={items} loading={false} />);

    const text = screen.getByText('Automation "initial" failed for Praneeth');
    expect(text.className).toContain('text-red-300');
    expect(text.closest('a')?.getAttribute('href')).toBe(
      '/automations/auto-uuid/logs'
    );
    const badge = text.previousElementSibling!;
    expect(badge.className).toContain('text-red-400');
    expect(badge.querySelector('svg.lucide-triangle-alert')).toBeTruthy();
  });

  it('falls back to the automations list when the failure carries no id', () => {
    const items: ActivityItem[] = [
      {
        id: 'auto-2',
        kind: 'automation',
        text: 'Automation "x" failed for a contact',
        at: AT,
        failed: true,
      },
    ];
    render(<ActivityFeed items={items} loading={false} />);

    expect(
      screen
        .getByText('Automation "x" failed for a contact')
        .closest('a')
        ?.getAttribute('href')
    ).toBe('/automations');
  });

  it('renders a successful automation like any other entry', () => {
    const items: ActivityItem[] = [
      {
        id: 'auto-3',
        kind: 'automation',
        text: 'Automation "x" triggered for Asha',
        at: AT,
      },
    ];
    render(<ActivityFeed items={items} loading={false} />);

    const text = screen.getByText('Automation "x" triggered for Asha');
    expect(text.className).toContain('text-slate-200');
    expect(text.closest('a')).toBeNull();
    expect(
      text.previousElementSibling!.querySelector('svg.lucide-triangle-alert')
    ).toBeNull();
  });
});

// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { TeamWorkload } from './team-workload';

afterEach(cleanup);

describe('TeamWorkload', () => {
  it('links the unassigned queue count to the inbox', () => {
    render(
      <TeamWorkload unassignedCount={684} agentLoad={[]} loading={false} />
    );

    const link = screen.getByRole('link', {
      name: 'Open inbox: 684 unassigned conversations',
    });
    expect(link.getAttribute('href')).toBe('/inbox');
    expect(link.textContent).toBe('684');
  });
});

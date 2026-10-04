// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProjectWithStats } from '@/lib/inventory/projects';
import { ProjectCard } from './projects-content';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ accountId: 'a' }) }));
vi.mock('@/components/inventory/project-form-dialog', () => ({
  ProjectFormDialog: () => null,
}));
vi.mock('@/components/inventory/project-units-dialog', () => ({
  ProjectUnitsDialog: () => null,
}));

function project(over: Partial<ProjectWithStats> = {}): ProjectWithStats {
  return {
    id: 'proj-1',
    account_id: 'a',
    name: 'Purva Atmosphere',
    builder: 'Puravankara',
    sublocality: 'RK Hegde Nagar',
    city: 'Bengaluru',
    stats: {
      project_id: 'proj-1',
      units: 8,
      available: 6,
      sold_or_contract: 2,
      min_price: 24000000,
      max_price: 31000000,
      min_rate_per_sqft: 14333,
      max_rate_per_sqft: 15800,
      min_bedrooms: 3,
      max_bedrooms: 3,
    },
    ...over,
  } as ProjectWithStats;
}

afterEach(cleanup);

describe('ProjectCard', () => {
  it('[PRP-036] reads sales as progress with a bar at the sold share', () => {
    render(
      <ProjectCard
        project={project()}
        onEdit={vi.fn()}
        onManageUnits={vi.fn()}
      />
    );
    expect(screen.getByText('2 of 8 units sold')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Units sold' });
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
  });

  it('[PRP-036] opens the units from the card itself and keeps Edit separate', () => {
    const onEdit = vi.fn();
    const onManageUnits = vi.fn();
    render(
      <ProjectCard
        project={project()}
        onEdit={onEdit}
        onManageUnits={onManageUnits}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open units of Purva Atmosphere' })
    );
    fireEvent.click(screen.getByRole('button', { name: /manage units/i }));
    expect(onManageUnits).toHaveBeenCalledTimes(2);
    const actionRow = screen.getByRole('button', { name: /manage units/i })
      .parentElement as HTMLElement;
    expect(actionRow.className).toContain('pointer-events-none');
    expect(screen.getByRole('button', { name: /edit/i }).className).toContain(
      'pointer-events-auto'
    );
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onManageUnits).toHaveBeenCalledTimes(2);
  });

  it('[PRP-036] shows no bar for a project with no units yet', () => {
    render(
      <ProjectCard
        project={project({
          stats: {
            project_id: 'proj-1',
            units: 0,
            available: 0,
            sold_or_contract: 0,
            min_price: null,
            max_price: null,
            min_rate_per_sqft: null,
            max_rate_per_sqft: null,
            min_bedrooms: null,
            max_bedrooms: null,
          },
        })}
        onEdit={vi.fn()}
        onManageUnits={vi.fn()}
      />
    );
    expect(screen.getByText('No units added yet')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

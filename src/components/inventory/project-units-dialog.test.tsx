// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { Project } from '@/types';

interface Row {
  id: string;
  title: string;
  project_id: string | null;
}

const ROWS: Row[] = [
  { id: 'u1', title: 'Tower A 101', project_id: 'proj-1' },
  { id: 'u2', title: 'Lake View Flat', project_id: null },
  { id: 'u3', title: 'Garden Villa', project_id: null },
];

const selects = vi.hoisted(() => ({ calls: [] as string[] }));
const updates = vi.hoisted(() => ({
  calls: [] as Array<{ project_id: string | null; ids: string[] }>,
}));

function builder() {
  const filters: { title?: string; project?: string } = {};
  let update: { project_id: string | null } | null = null;
  let ids: string[] = [];
  const run = () => {
    if (update) {
      updates.calls.push({ project_id: update.project_id, ids });
      return { data: ids.map((id) => ({ id })), error: null };
    }
    selects.calls.push(filters.title ?? (filters.project ? 'mine' : ''));
    const data = ROWS.filter((r) =>
      filters.project ? r.project_id === filters.project : true
    ).filter((r) =>
      filters.title
        ? r.title.toLowerCase().includes(filters.title.toLowerCase())
        : true
    );
    return { data, error: null };
  };
  const chain = {
    select: () => chain,
    update: (value: { project_id: string | null }) => {
      update = value;
      return chain;
    },
    eq: (column: string, value: string) => {
      if (column === 'project_id') filters.project = value;
      return chain;
    },
    in: (_column: string, value: string[]) => {
      ids = value;
      return chain;
    },
    ilike: (_column: string, pattern: string) => {
      filters.title = pattern.replace(/%/g, '');
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    then: (resolve: (value: ReturnType<typeof run>) => unknown) =>
      Promise.resolve(run()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => builder() }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ accountId: 'acct-1' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectUnitsDialog } from './project-units-dialog';

const PROJECT = { id: 'proj-1', name: 'Skyline' } as Project;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  selects.calls = [];
  updates.calls = [];
});

function checkbox(title: string) {
  return screen
    .getByText(title)
    .closest('label')!
    .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

describe('ProjectUnitsDialog', () => {
  it('[UIX-036] keeps ticked units through a search and debounces the query', async () => {
    render(
      <ProjectUnitsDialog
        project={PROJECT}
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
      />
    );

    await screen.findByText('Lake View Flat');
    expect(checkbox('Tower A 101').checked).toBe(true);
    fireEvent.click(checkbox('Lake View Flat'));
    expect(checkbox('Lake View Flat').checked).toBe(true);

    const initialLoads = selects.calls.length;
    vi.useFakeTimers();
    const input = screen.getByPlaceholderText('Search listings by title');
    fireEvent.change(input, { target: { value: 'G' } });
    fireEvent.change(input, { target: { value: 'Ga' } });
    fireEvent.change(input, { target: { value: 'Garden' } });
    expect(selects.calls.length).toBe(initialLoads);
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    vi.useRealTimers();

    await screen.findByText('Garden Villa');
    expect(selects.calls.filter((c) => c === 'Garden')).toHaveLength(1);
    expect(selects.calls).not.toContain('G');
    expect(checkbox('Lake View Flat').checked).toBe(true);
    expect(checkbox('Tower A 101').checked).toBe(true);
    expect(checkbox('Garden Villa').checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Save units/ }));
    await waitFor(() =>
      expect(updates.calls).toContainEqual({
        project_id: 'proj-1',
        ids: ['u2'],
      })
    );
    expect(updates.calls.some((u) => u.project_id === null)).toBe(false);
  });
});

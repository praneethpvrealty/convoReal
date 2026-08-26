import { describe, expect, it } from 'vitest';

import { sortTodos, type SortableTodo } from '@/lib/todo-sort';

function makeTodo(overrides: Partial<SortableTodo> = {}): SortableTodo {
  return {
    id: overrides.id ?? '1',
    completed: overrides.completed ?? false,
    due_date: overrides.due_date ?? null,
  };
}

describe('sortTodos', () => {
  it('puts open tasks ahead of completed tasks', () => {
    const open = makeTodo({ id: 'open', completed: false });
    const done = makeTodo({ id: 'done', completed: true });
    const sorted = sortTodos([done, open]);
    expect(sorted.map((t) => t.id)).toEqual(['open', 'done']);
  });

  it('sorts dated tasks before undated tasks within the same status', () => {
    const dated = makeTodo({ id: 'dated', due_date: '2026-08-20T09:00:00Z' });
    const undated = makeTodo({ id: 'undated' });
    const sorted = sortTodos([undated, dated]);
    expect(sorted.map((t) => t.id)).toEqual(['dated', 'undated']);
  });

  it('sorts open tasks by descending due date (newest first)', () => {
    const aug15 = makeTodo({ id: 'aug15', due_date: '2026-08-15T09:00:00Z' });
    const aug20 = makeTodo({ id: 'aug20', due_date: '2026-08-20T09:00:00Z' });
    const aug10 = makeTodo({ id: 'aug10', due_date: '2026-08-10T09:00:00Z' });
    const sorted = sortTodos([aug10, aug15, aug20]);
    expect(sorted.map((t) => t.id)).toEqual(['aug20', 'aug15', 'aug10']);
  });

  it('sorts completed tasks by descending due date after open tasks', () => {
    const open = makeTodo({ id: 'open', completed: false, due_date: '2026-08-01T09:00:00Z' });
    const doneAug20 = makeTodo({ id: 'done20', completed: true, due_date: '2026-08-20T09:00:00Z' });
    const doneAug10 = makeTodo({ id: 'done10', completed: true, due_date: '2026-08-10T09:00:00Z' });
    const sorted = sortTodos([doneAug10, open, doneAug20]);
    expect(sorted.map((t) => t.id)).toEqual(['open', 'done20', 'done10']);
  });

  it('handles mixed dated and undated tasks across statuses', () => {
    const openDated = makeTodo({ id: 'od', completed: false, due_date: '2026-08-15T09:00:00Z' });
    const openUndated = makeTodo({ id: 'ou', completed: false });
    const doneDated = makeTodo({ id: 'dd', completed: true, due_date: '2026-08-20T09:00:00Z' });
    const doneUndated = makeTodo({ id: 'du', completed: true });
    const sorted = sortTodos([doneUndated, openUndated, doneDated, openDated]);
    expect(sorted.map((t) => t.id)).toEqual(['od', 'ou', 'dd', 'du']);
  });

  it('does not mutate the original array', () => {
    const a = makeTodo({ id: 'a', completed: true });
    const b = makeTodo({ id: 'b', completed: false });
    const input = [a, b];
    sortTodos(input);
    expect(input.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

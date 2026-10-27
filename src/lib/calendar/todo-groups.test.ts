import { describe, expect, it } from 'vitest';

import {
  CLEAR_COMPLETED_LABEL,
  DEAL_TASK_LABEL,
  DONE_TODOS_LABEL,
  OVERDUE_TODO_LABEL,
  TODO_PRIORITY_LABELS,
  clearCompletedPrompt,
  completedTodoIds,
  isTodoOverdue,
  splitTodosByCompletion,
} from './todo-groups';

const todo = (id: string, completed: boolean) => ({ id, completed });

describe('[CAL-009] the to-do list keeps finished work in its own group', () => {
  it('splits open and done to-dos without reordering either', () => {
    const { open, done } = splitTodosByCompletion([
      todo('a', false),
      todo('b', true),
      todo('c', false),
      todo('d', true),
    ]);
    expect(open.map((t) => t.id)).toEqual(['a', 'c']);
    expect(done.map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('returns empty groups for an empty list', () => {
    expect(splitTodosByCompletion([])).toEqual({ open: [], done: [] });
  });

  it('clears only the done to-dos', () => {
    expect(
      completedTodoIds([todo('a', false), todo('b', true), todo('c', true)])
    ).toEqual(['b', 'c']);
    expect(completedTodoIds([todo('a', false)])).toEqual([]);
  });

  it('names the group and the action the same way on both surfaces', () => {
    expect(DONE_TODOS_LABEL).toBe('Done');
    expect(CLEAR_COMPLETED_LABEL).toBe('Clear completed');
    expect(clearCompletedPrompt(1)).toBe(
      'Delete the one done to-do? This cannot be undone.'
    );
    expect(clearCompletedPrompt(3)).toBe(
      'Delete all 3 done to-dos? This cannot be undone.'
    );
  });
});

describe('[UIX-008] to-do labels read the same on web and mobile', () => {
  const now = new Date('2026-10-27T10:00:00Z');

  it('marks an open to-do past its due time as overdue', () => {
    expect(
      isTodoOverdue({ completed: false, due_date: '2026-10-27T09:59:00Z' }, now)
    ).toBe(true);
  });

  it('never marks a done, undated, future or unparseable to-do overdue', () => {
    expect(
      isTodoOverdue({ completed: true, due_date: '2026-10-20T09:00:00Z' }, now)
    ).toBe(false);
    expect(isTodoOverdue({ completed: false, due_date: null }, now)).toBe(
      false
    );
    expect(
      isTodoOverdue({ completed: false, due_date: '2026-10-27T10:01:00Z' }, now)
    ).toBe(false);
    expect(isTodoOverdue({ completed: false, due_date: 'soon' }, now)).toBe(
      false
    );
  });

  it('names priorities, overdue and deal tasks in one casing', () => {
    expect(TODO_PRIORITY_LABELS).toEqual({
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    });
    expect(OVERDUE_TODO_LABEL).toBe('Overdue');
    expect(DEAL_TASK_LABEL).toBe('Deal task');
  });
});

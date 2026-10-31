import type { Todo, TodoPriority } from './todos';

type DraftValue = string | number | boolean | null | undefined | string[];

function normalise(value: DraftValue): string {
  if (Array.isArray(value)) return value.join('\u0000');
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value);
}

export function hasUnsavedChanges<T extends Record<string, DraftValue>>(
  saved: T,
  draft: T
): boolean {
  return (Object.keys(saved) as (keyof T)[]).some(
    (key) => normalise(saved[key]) !== normalise(draft[key])
  );
}

export interface TodoEditDraft extends Record<string, DraftValue> {
  title: string;
  description: string;
  priority: TodoPriority;
  completed: boolean;
  due: string | null;
}

export function todoEditDraft(
  todo: Pick<
    Todo,
    'title' | 'description' | 'priority' | 'completed' | 'due_date'
  >
): TodoEditDraft {
  return {
    title: todo.title,
    description: todo.description ?? '',
    priority: todo.priority,
    completed: todo.completed,
    due: todo.due_date ? new Date(todo.due_date).toISOString() : null,
  };
}

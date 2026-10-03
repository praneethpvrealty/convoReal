/**
 * The To-do list's open / done split (CAL-009), shared at runtime by web
 * and mobile. The mobile app bundles this file through `@shared/`, so it
 * must stay free of imports — mobile/metro.config.js refuses any that
 * are not relative, and src/lib/mobile-parity.test.ts checks the same
 * from the web side.
 */

export interface CompletableTodoLike {
  id: string;
  completed: boolean;
}

export const DONE_TODOS_LABEL = 'Done';
export const CLEAR_COMPLETED_LABEL = 'Clear completed';

/** Open to-dos lead the list in the order given; done ones sit in their
 *  own group, collapsed by default, so finished work stops pushing the
 *  open work out of view. */
export function splitTodosByCompletion<T extends CompletableTodoLike>(
  todos: readonly T[]
): { open: T[]; done: T[] } {
  const open: T[] = [];
  const done: T[] = [];
  for (const todo of todos) (todo.completed ? done : open).push(todo);
  return { open, done };
}

export function completedTodoIds(
  todos: readonly CompletableTodoLike[]
): string[] {
  return todos.filter((todo) => todo.completed).map((todo) => todo.id);
}

export function clearCompletedPrompt(count: number): string {
  return count === 1
    ? 'Delete the one done to-do? This cannot be undone.'
    : `Delete all ${count} done to-dos? This cannot be undone.`;
}

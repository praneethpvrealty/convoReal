import { Alert } from 'react-native';

import { openContactChat } from '@/lib/open-chat';
import { buildTodoParticipantCheckIn } from '@/lib/todo-check-in';
import { sortTodos as sortTodosImpl } from '@/lib/todo-sort';
import { supabase } from '@/lib/supabase';

/**
 * Web parity: the calendar's To-Do task list. Todos are plain
 * RLS-scoped rows with no server-side side effects (unlike
 * appointments, whose reminders live behind the API), so reads and
 * writes go straight to the table like the web calendar's do.
 */

export type TodoPriority = 'low' | 'medium' | 'high';

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TodoPriority;
  completed: boolean;
  contact_id: string | null;
  property_id: string | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
  property: { id: string; title: string } | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type TodoCheckInContext = Pick<Todo, 'id' | 'title' | 'description' | 'completed'> & {
  contact: Todo['contact'] | Todo['contact'][] | null;
  property: Todo['property'] | Todo['property'][] | null;
};

async function fetchTodoCheckInContext(id: string): Promise<TodoCheckInContext | null> {
  const { data, error } = await supabase
    .from('todos')
    .select(
      'id, title, description, completed, contact:contacts(id, name, phone), property:properties(id, title)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as TodoCheckInContext | null) ?? null;
}

/**
 * Participant-linked work should not disappear from the open queue before
 * the agent has had a chance to verify what actually happened. The choice
 * is explicit:
 * - Check in first: open a reviewable message draft and KEEP the task open.
 * - Complete now: close it deliberately.
 * - Keep open: do nothing.
 */
async function resolveCompletionIntent(
  context: TodoCheckInContext | null,
  title?: string,
  description?: string | null
): Promise<boolean> {
  if (!context || context.completed) return true;
  const contact = one(context.contact);
  if (!contact) return true;

  const property = one(context.property);
  const draft = buildTodoParticipantCheckIn({
    title: title ?? context.title,
    description: description === undefined ? context.description : description,
    contactName: contact.name,
    propertyTitle: property?.title,
  });
  const participant = contact.name || contact.phone || 'the participant';

  return new Promise((resolve) => {
    Alert.alert(
      'Open → Completed',
      `Before closing this task, do you want to check with ${participant} about the ${draft.label}?`,
      [
        {
          text: 'Keep open',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: 'Check in first',
          onPress: () => {
            void openContactChat(contact, { draftText: draft.message });
            resolve(false);
          },
        },
        {
          text: 'Complete now',
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      }
    );
  });
}

export async function fetchTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select(
      '*, contact:contacts(id, name, phone), property:properties(id, title)'
    )
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  type Row = Omit<Todo, 'contact' | 'property'> & {
    contact: Todo['contact'] | Todo['contact'][] | null;
    property: Todo['property'] | Todo['property'][] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row,
    contact: one(row.contact),
    property: one(row.property),
  }));
}

/** Open tasks first; within each status, newest due date first. */
export function sortTodos(todos: Todo[]): Todo[] {
  return sortTodosImpl(todos);
}

export async function addTodo(opts: {
  accountId: string;
  title: string;
  priority: TodoPriority;
  dueDate: Date | null;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('todos').insert({
    account_id: opts.accountId,
    user_id: user?.id,
    title: opts.title,
    priority: opts.priority,
    due_date: opts.dueDate ? opts.dueDate.toISOString() : null,
    completed: false,
  });
  if (error) throw error;
}

export async function setTodoCompleted(
  id: string,
  completed: boolean
): Promise<void> {
  const checkInContext = completed ? await fetchTodoCheckInContext(id) : null;
  const shouldComplete = completed
    ? await resolveCompletionIntent(checkInContext)
    : false;
  const nextCompleted = completed ? shouldComplete : false;

  // The user chose Check in first / Keep open. Do not perform a no-op write:
  // leaving the row untouched also avoids changing updated_at/audit ordering.
  if (completed && !nextCompleted) return;

  const { data, error } = await supabase
    .from('todos')
    .update({ completed: nextCompleted })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Todo not found');
}

export async function updateTodo(
  id: string,
  updates: {
    title: string;
    description: string | null;
    dueDate: Date | null;
    priority: TodoPriority;
    completed: boolean;
  }
): Promise<void> {
  const checkInContext = updates.completed ? await fetchTodoCheckInContext(id) : null;
  const completingFromOpen =
    updates.completed && checkInContext && !checkInContext.completed;
  const shouldComplete = completingFromOpen
    ? await resolveCompletionIntent(
        checkInContext,
        updates.title,
        updates.description
      )
    : updates.completed;

  const { data, error } = await supabase
    .from('todos')
    .update({
      title: updates.title,
      description: updates.description,
      due_date: updates.dueDate ? updates.dueDate.toISOString() : null,
      priority: updates.priority,
      // If the agent chose "Check in first", save their other edits but
      // deliberately keep the task Open until they come back and close it.
      completed: shouldComplete,
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Todo not found');
}

export async function deleteTodo(id: string): Promise<void> {
  // Same guard as setTodoCompleted: a delete RLS refuses removes zero
  // rows and reports no error, so without reading the row back this
  // resolves as success and the caller re-renders the task it just told
  // the user was gone.
  const { data, error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Todo not found');
}

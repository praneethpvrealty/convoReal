import type { TypedSupabaseClient } from '@/lib/supabase/database';
import type { CalendarEvent } from '@/components/calendar/event-types';
import {
  APPOINTMENT_SELECT,
  DONE_TODOS_PAGE_SIZE,
  PAST_APPOINTMENTS_PAGE_SIZE,
  TODO_SELECT,
  loadAllPages,
  type CalendarWindow,
} from '@/lib/calendar/calendar-data';

type DB = TypedSupabaseClient;

export type TodoPriorityFilter = 'all' | 'priority';

const PRIORITY_FILTER_VALUES = ['high', 'medium'];

/** A lightweight to-do (CAL-009): title, notes, due, priority. The
 *  contact/property/deal links are read-only here — a deal task carries
 *  its deal from the workspace; the calendar never tags one. */
export interface CalendarTodo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  contact_id?: string | null;
  property_id?: string | null;
  deal_id?: string | null;
  created_at?: string | null;
  contact?: {
    id: string;
    name: string;
    phone: string;
  } | null;
  property?: {
    id: string;
    title: string;
    location: string | null;
    sublocality: string | null;
  } | null;
}

export interface DoneTodosPage {
  rows: CalendarTodo[];
  total: number | null;
}

export const calendarKey = (accountId: string | null | undefined) =>
  ['calendar', accountId ?? null] as const;
export const appointmentsKey = (accountId: string | null | undefined) =>
  [...calendarKey(accountId), 'appointments'] as const;
export const todosKey = (accountId: string | null | undefined) =>
  [...calendarKey(accountId), 'todos'] as const;

export function loadWindowAppointments(
  db: DB,
  accountId: string,
  window: CalendarWindow
): Promise<CalendarEvent[]> {
  return loadAllPages(async (from, to) => {
    const { data, error } = await db
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('account_id', accountId)
      .gte('start_time', window.from.toISOString())
      .lt('start_time', window.to.toISOString())
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as unknown as CalendarEvent[];
  });
}

export function loadUpcomingAppointments(
  db: DB,
  accountId: string,
  since: Date
): Promise<CalendarEvent[]> {
  return loadAllPages(async (from, to) => {
    const { data, error } = await db
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('account_id', accountId)
      .gte('start_time', since.toISOString())
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as unknown as CalendarEvent[];
  });
}

export async function loadPastAppointmentsPage(
  db: DB,
  accountId: string,
  before: Date,
  offset: number
): Promise<CalendarEvent[]> {
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('account_id', accountId)
    .lt('start_time', before.toISOString())
    .order('start_time', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAST_APPOINTMENTS_PAGE_SIZE - 1);
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEvent[];
}

export async function loadAppointmentById(
  db: DB,
  accountId: string,
  id: string
): Promise<CalendarEvent | null> {
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CalendarEvent | null) ?? null;
}

export function loadOpenTodos(
  db: DB,
  accountId: string
): Promise<CalendarTodo[]> {
  return loadAllPages(async (from, to) => {
    const { data, error } = await db
      .from('todos')
      .select(TODO_SELECT)
      .eq('account_id', accountId)
      .eq('completed', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as unknown as CalendarTodo[];
  });
}

export async function loadDoneTodosPage(
  db: DB,
  accountId: string,
  filter: TodoPriorityFilter,
  offset: number
): Promise<DoneTodosPage> {
  let query = db
    .from('todos')
    .select(TODO_SELECT, offset === 0 ? { count: 'exact' } : undefined)
    .eq('account_id', accountId)
    .eq('completed', true);
  if (filter === 'priority') {
    query = query.in('priority', PRIORITY_FILTER_VALUES);
  }
  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + DONE_TODOS_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: (data ?? []) as unknown as CalendarTodo[],
    total: offset === 0 ? (count ?? null) : null,
  };
}

/** Every done to-do's id under the list's filter, for Clear completed:
 *  the Done group shows a page at a time, the clear covers all of it. */
export function loadDoneTodoIds(
  db: DB,
  accountId: string,
  filter: TodoPriorityFilter
): Promise<string[]> {
  return loadAllPages(async (from, to) => {
    let query = db
      .from('todos')
      .select('id')
      .eq('account_id', accountId)
      .eq('completed', true);
    if (filter === 'priority') {
      query = query.in('priority', PRIORITY_FILTER_VALUES);
    }
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []).map((row) => row.id);
  });
}

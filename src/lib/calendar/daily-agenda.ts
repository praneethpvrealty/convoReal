import type { SupabaseClient } from '@supabase/supabase-js';

import {
  unwrapRelation,
  type AgendaContact,
} from '@/lib/calendar/agenda-format';

export interface DailyAgendaEvent {
  title: string;
  eventType: string | null;
  startTime: string;
  location: string | null;
  status: string;
  contact: AgendaContact | null;
}

export interface DailyAgendaTodo {
  title: string;
  priority: string;
  dueDate: string | null;
  contact: AgendaContact | null;
}

export interface DailyAgenda {
  date: string;
  label: string;
  events: DailyAgendaEvent[];
  dated: DailyAgendaTodo[];
  undated: DailyAgendaTodo[];
  datedOmitted: boolean;
}

const MAX_UNDATED = 50;
const MAX_DATED = 200;

export function istWindowForDate(date: string): {
  startIso: string;
  endIso: string;
  label: string;
} {
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const label = start.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return { startIso: start.toISOString(), endIso: end.toISOString(), label };
}

function rank(priority: string): number {
  return priority === 'high' ? 0 : priority === 'low' ? 2 : 1;
}

export async function loadDailyAgenda(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  date: string
): Promise<DailyAgenda> {
  const { startIso, endIso, label } = istWindowForDate(date);
  const id = userId.replace(/[\\"]/g, '\\$&');
  const mine = `assigned_to.eq."${id}",and(assigned_to.is.null,user_id.eq."${id}")`;

  const [events, dated, undated] = await Promise.all([
    admin
      .from('appointments')
      .select(
        'title, event_type, start_time, location, status, contact:contacts(name, phone)'
      )
      .eq('account_id', accountId)
      .or(mine)
      .neq('status', 'cancelled')
      .gte('start_time', startIso)
      .lt('start_time', endIso)
      .order('start_time', { ascending: true }),
    admin
      .from('todos')
      .select('title, priority, due_date, contact:contacts(name, phone)')
      .eq('account_id', accountId)
      .eq('completed', false)
      .or(mine)
      .not('due_date', 'is', null)
      .lt('due_date', endIso)
      .order('due_date', { ascending: false })
      .limit(MAX_DATED + 1),
    admin
      .from('todos')
      .select('title, priority, due_date, contact:contacts(name, phone)')
      .eq('account_id', accountId)
      .eq('completed', false)
      .or(mine)
      .is('due_date', null)
      .order('created_at', { ascending: false })
      .limit(MAX_UNDATED),
  ]);
  for (const res of [events, dated, undated]) {
    if (res.error) throw res.error;
  }

  const toTodo = (row: Record<string, unknown>): DailyAgendaTodo => ({
    title: String(row.title ?? ''),
    priority: String(row.priority ?? 'medium'),
    dueDate: (row.due_date as string | null) ?? null,
    contact: unwrapRelation(
      row.contact as AgendaContact | AgendaContact[] | null
    ),
  });
  const byPriority = (a: DailyAgendaTodo, b: DailyAgendaTodo) =>
    rank(a.priority) - rank(b.priority) ||
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  const datedRows = dated.data ?? [];

  return {
    date,
    label,
    events: (events.data ?? []).map((row: Record<string, unknown>) => ({
      title: String(row.title ?? ''),
      eventType: (row.event_type as string | null) ?? null,
      startTime: String(row.start_time),
      location: (row.location as string | null) ?? null,
      status: String(row.status ?? 'scheduled'),
      contact: unwrapRelation(
        row.contact as AgendaContact | AgendaContact[] | null
      ),
    })),
    dated: datedRows.slice(0, MAX_DATED).map(toTodo).sort(byPriority),
    undated: (undated.data ?? []).map(toTodo).sort(byPriority),
    datedOmitted: datedRows.length > MAX_DATED,
  };
}

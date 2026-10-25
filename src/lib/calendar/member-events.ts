import type { SupabaseClient } from '@supabase/supabase-js';

import {
  FEED_MAX_ITEMS,
  appointmentToIcsEvent,
  feedWindow,
  todoToIcsEvent,
  type FeedAppointment,
  type FeedTodo,
  type IcsEvent,
} from '@/lib/calendar/ics-feed';

export async function activeMemberAccountName(
  admin: SupabaseClient,
  accountId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('account_id, account:accounts!inner(name, status)')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  const account = Array.isArray(data?.account)
    ? data.account[0]
    : data?.account;
  if (!data || !account || account.status === 'archived') return null;
  return account.name as string;
}

export async function loadMemberCalendarEvents(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  appUrl: string,
  now: Date
): Promise<IcsEvent[]> {
  const { from, to } = feedWindow(now);
  const ownedBy = `assigned_to.eq.${userId},and(assigned_to.is.null,user_id.eq.${userId})`;

  const [appointments, todos] = await Promise.all([
    admin
      .from('appointments')
      .select(
        'id, title, description, agenda, start_time, end_time, location, event_type, updated_at, ' +
          'contact:contacts(name, phone), property:properties(title)'
      )
      .eq('account_id', accountId)
      .or(ownedBy)
      .neq('status', 'cancelled')
      .gte('start_time', from.toISOString())
      .lte('start_time', to.toISOString())
      .order('start_time', { ascending: true })
      .limit(FEED_MAX_ITEMS),
    admin
      .from('todos')
      .select(
        'id, title, description, due_date, priority, updated_at, ' +
          'contact:contacts(name, phone), property:properties(title)'
      )
      .eq('account_id', accountId)
      .or(ownedBy)
      .eq('completed', false)
      .gte('due_date', from.toISOString())
      .lte('due_date', to.toISOString())
      .order('due_date', { ascending: true })
      .limit(FEED_MAX_ITEMS),
  ]);
  if (appointments.error) throw appointments.error;
  if (todos.error) throw todos.error;

  return [
    ...(appointments.data as unknown as FeedAppointment[]).map((a) =>
      appointmentToIcsEvent(a, appUrl)
    ),
    ...(todos.data as unknown as FeedTodo[]).map((t) =>
      todoToIcsEvent(t, appUrl)
    ),
  ].filter((event): event is IcsEvent => event !== null);
}

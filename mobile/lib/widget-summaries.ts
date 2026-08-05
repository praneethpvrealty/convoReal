import { bubbleTime, chatListTime, formatInr } from '@/lib/format';
import type { WidgetId } from '@/lib/home-widgets';
import { supabase } from '@/lib/supabase';

/** One glanceable line pair per widget — shared by the in-app dashboard
 *  cards and the Android home-screen widgets so both always agree. */
export interface WidgetSummaryLine {
  title: string;
  detail: string;
  time: string;
}

export interface WidgetSummary {
  value: string;
  sub: string;
  /** Latest items behind the number — currently only the inbox widget
   *  fills this (most recent chats, newest first). */
  lines?: WidgetSummaryLine[];
}

async function inboxSummary(): Promise<WidgetSummary> {
  const [unread, open, recent] = await Promise.all([
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gt('unread_count', 0)
      .eq('is_archived', false),
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('is_archived', false),
    supabase
      .from('conversations')
      .select('last_message_text, last_message_at, contact:contacts(name, phone)')
      .eq('is_archived', false)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(4),
  ]);
  const chats = (recent.data ?? []) as unknown as {
    last_message_text: string | null;
    last_message_at: string;
    contact: { name: string | null; phone: string | null } | null;
  }[];
  return {
    value: String(unread.count ?? 0),
    sub: `unread · ${open.count ?? 0} open chats`,
    lines: chats.map((c) => ({
      title: c.contact?.name || c.contact?.phone || 'Unknown',
      detail: c.last_message_text ?? '',
      time: chatListTime(c.last_message_at),
    })),
  };
}

async function calendarSummary(): Promise<WidgetSummary> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { data: rows, error } = await supabase
    .from('appointments')
    .select('id, title, start_time')
    .eq('status', 'scheduled')
    .gte('start_time', start.toISOString())
    .lt('start_time', end.toISOString())
    .order('start_time', { ascending: true })
    .limit(50);
  if (error) throw error;
  const appts = (rows ?? []) as { id: string; title: string; start_time: string }[];
  const now = Date.now();
  const next = appts.find((a) => new Date(a.start_time).getTime() >= now) ?? null;
  return {
    value: String(appts.length),
    sub: next
      ? `${bubbleTime(next.start_time)} · ${next.title}`
      : appts.length > 0
        ? 'all done for today'
        : 'nothing scheduled today',
  };
}

async function contactsSummary(): Promise<WidgetSummary> {
  const [total, hot] = await Promise.all([
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_temp', 'HOT'),
  ]);
  return {
    value: String(total.count ?? 0),
    sub: `contacts · ${hot.count ?? 0} hot leads`,
  };
}

async function propertiesSummary(): Promise<WidgetSummary> {
  const [available, total] = await Promise.all([
    supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Available'),
    supabase.from('properties').select('id', { count: 'exact', head: true }),
  ]);
  return {
    value: String(available.count ?? 0),
    sub: `available · ${total.count ?? 0} listings`,
  };
}

async function dealsSummary(): Promise<WidgetSummary> {
  const { data: rows, error } = await supabase
    .from('deals')
    .select('value')
    .eq('status', 'open');
  if (error) throw error;
  const open = (rows ?? []) as { value: number | null }[];
  return {
    value: formatInr(open.reduce((sum, d) => sum + (d.value ?? 0), 0)),
    sub: `${open.length} open deals`,
  };
}

async function broadcastsSummary(): Promise<WidgetSummary> {
  const { data: row, error } = await supabase
    .from('broadcasts')
    .select('id, name, status, total_recipients, sent_count')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const latest = row as {
    name: string;
    total_recipients: number;
    sent_count: number;
  } | null;
  return latest
    ? {
        value: `${latest.sent_count}/${latest.total_recipients}`,
        sub: `sent · ${latest.name}`,
      }
    : { value: '0', sub: 'no campaigns yet' };
}

export async function fetchWidgetSummary(id: WidgetId): Promise<WidgetSummary> {
  switch (id) {
    case 'inbox':
      return inboxSummary();
    case 'calendar':
      return calendarSummary();
    case 'contacts':
      return contactsSummary();
    case 'properties':
      return propertiesSummary();
    case 'deals':
      return dealsSummary();
    case 'broadcasts':
      return broadcastsSummary();
  }
}

/** Without a session RLS silently returns zero rows, which would render
 *  as convincing-but-wrong "0" widgets — check before fetching. */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

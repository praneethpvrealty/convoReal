// ============================================================
// The event an outcome report is about, without a card to name it.
//
// Closing a visit used to require the agent's reply to be traceable to
// a bot message the Engine had registered: a quote-reply on a
// confirmation card, or the newest such card in the thread. Both are
// message plumbing, and both fail for a card sent before that plumbing
// existed — so a bot whose whole purpose is to ask "how did it go?"
// could not read the answer to any question it had already asked.
//
// The reply itself is the better evidence. "He visited the property
// yesterday" is about the agent's own open visit that has already
// happened, and there is usually exactly one of those. When there is
// exactly one, it is the subject. When there are several, guessing
// which would close the wrong meeting — so the caller asks.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OpenEvent {
  id: string;
  title: string;
  start_time: string;
}

export type OpenEventSubject =
  | { kind: 'one'; event: OpenEvent }
  | { kind: 'many'; events: OpenEvent[] }
  | { kind: 'none' };

/**
 * The agent's events that are still open although their time has
 * passed — exactly what the overdue nudge asks about.
 *
 * Bounded to the same 48-hour window the nudge itself uses: past that
 * the agent has moved on, and a stale event is better left to the
 * Calendar page than closed by a sentence about something else.
 */
export async function openOverdueEvents(params: {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  now?: Date;
  withinHours?: number;
}): Promise<OpenEvent[]> {
  const now = params.now || new Date();
  const since = new Date(
    now.getTime() - (params.withinHours ?? 48) * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await params.db
    .from('appointments')
    .select('id, title, start_time, end_time, assigned_to, user_id')
    .eq('account_id', params.accountId)
    .eq('status', 'scheduled')
    .lt('end_time', now.toISOString())
    .gte('end_time', since)
    .order('end_time', { ascending: false })
    .limit(10);
  if (error) {
    console.error('[open-event-subject] lookup failed:', error);
    return [];
  }

  // assigned_to wins over user_id — an event booked by the manager and
  // assigned to an agent is the agent's to report on, and it is the
  // assignee the nudge went to.
  return (data || [])
    .filter((r) => (r.assigned_to || r.user_id) === params.userId)
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      start_time: r.start_time as string,
    }));
}

/** One open event is the subject; several are a question. */
export function subjectOf(events: OpenEvent[]): OpenEventSubject {
  if (events.length === 0) return { kind: 'none' };
  if (events.length === 1) return { kind: 'one', event: events[0] };
  return { kind: 'many', events };
}

/** How one candidate reads in the "which one do you mean?" list. */
export function openEventLabel(event: OpenEvent): string {
  const when = new Date(event.start_time).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${event.title} — ${when}`;
}

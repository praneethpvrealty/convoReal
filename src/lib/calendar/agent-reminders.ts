// ============================================================
// Agent-facing WhatsApp reminders — the other half of the
// reminder cron. checkAndSendAppointmentReminders() (lib/
// appointments/reminder.ts) nudges the CLIENT; these nudge the
// TEAM MEMBER the event is assigned to, on their own WhatsApp:
//
//  1. Pre-event brief ~1h before: what, who (with tap-to-call
//     number), where (with a Google Maps link).
//  2. Morning digest: the member's full day, sent once per IST
//     day (deduped via agent_digest_log even across cron races).
//  3. Overdue nudge: an event that ended hours ago but was never
//     marked complete — the CRM asks instead of the manager.
//
// Sends are free-form text via the account's own WhatsApp number;
// if the 24h service window is closed Meta rejects the send and we
// simply log it (flags stay unset for pre-event so the next tick
// can retry).
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { formatAgendaMessage, istDayWindow, istHourOf } from '@/lib/calendar/whatsapp-scheduler';

const EVENT_TYPE_EMOJI: Record<string, string> = {
  site_visit: '📍',
  call: '📞',
  follow_up: '🔁',
  document: '📄',
  meeting: '🤝',
  other: '🗓',
};

function istTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function mapsLink(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

interface ReminderAppointment {
  id: string;
  account_id: string;
  user_id: string | null;
  assigned_to: string | null;
  title: string;
  event_type: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  agenda?: string | null;
  contact_ids?: string[] | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
  property: { id: string; title: string | null; location: string | null } | null;
}

/** Every attendee on the event — the contact_ids parties, with the
 *  legacy single contact as fallback — for the assignee's brief. */
function attendeesOf(
  appt: ReminderAppointment,
  contactById: Map<string, { id: string; name: string | null; phone: string | null }>
): { name: string | null; phone: string | null }[] {
  const ids = new Set<string>(appt.contact_ids || []);
  if (appt.contact?.id) ids.add(appt.contact.id);
  return [...ids]
    .map((id) => (appt.contact?.id === id ? appt.contact : contactById.get(id)))
    .filter((c): c is { id: string; name: string | null; phone: string | null } => !!c);
}

async function loadAssigneePhones(
  userIds: string[]
): Promise<Map<string, { phone: string; full_name: string | null }>> {
  const map = new Map<string, { phone: string; full_name: string | null }>();
  if (userIds.length === 0) return map;
  const { data: profiles } = await supabaseAdmin()
    .from('profiles')
    .select('user_id, phone, full_name')
    .in('user_id', userIds);
  for (const p of profiles || []) {
    if (!p.phone) continue;
    const sanitized = sanitizePhoneForMeta(p.phone);
    if (!isValidE164(sanitized)) continue;
    map.set(p.user_id, { phone: p.phone, full_name: p.full_name });
  }
  return map;
}

/** ~1 hour before start: brief the assignee with everything they need
 *  to walk in prepared. Marked sent only on success so transient
 *  failures retry on the next cron tick. */
export async function sendAgentEventReminders(now: Date = new Date()): Promise<void> {
  const admin = supabaseAdmin();
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

  const { data: appointments, error } = await admin
    .from('appointments')
    .select('id, account_id, user_id, assigned_to, title, event_type, start_time, end_time, location, agenda, contact_ids, contact:contacts(id, name, phone), property:properties(id, title, location)')
    .eq('status', 'scheduled')
    .eq('agent_reminder_sent', false)
    .gt('start_time', now.toISOString())
    .lte('start_time', windowEnd.toISOString());

  if (error) {
    console.error('[Agent Reminder] fetch failed:', error);
    return;
  }
  if (!appointments || appointments.length === 0) return;

  const rows = appointments as unknown as ReminderAppointment[];
  const assignees = await loadAssigneePhones(
    [...new Set(rows.map((a) => a.assigned_to || a.user_id).filter(Boolean))] as string[]
  );

  // Attendees beyond the primary contact (multi-contact events) need
  // their own lookup — the join above only covers contact_id.
  const extraContactIds = [
    ...new Set(rows.flatMap((a) => (a.contact_ids || []).filter((id) => id !== a.contact?.id))),
  ];
  const contactById = new Map<string, { id: string; name: string | null; phone: string | null }>();
  if (extraContactIds.length > 0) {
    const { data: extraContacts } = await admin
      .from('contacts')
      .select('id, name, phone')
      .in('id', extraContactIds);
    for (const c of extraContacts || []) contactById.set(c.id, c);
  }

  for (const appt of rows) {
    const assigneeId = appt.assigned_to || appt.user_id;
    const assignee = assigneeId ? assignees.get(assigneeId) : undefined;
    if (!assignee) {
      // No reachable phone — mark sent so we don't re-scan it forever.
      await admin.from('appointments').update({ agent_reminder_sent: true }).eq('id', appt.id);
      continue;
    }

    const emoji = EVENT_TYPE_EMOJI[appt.event_type || 'other'] || '🗓';
    const lines = [
      `⏰ *Coming up at ${istTime(appt.start_time)}*`,
      `${emoji} ${appt.title}`,
      ...attendeesOf(appt, contactById).map(
        (c) => `👤 ${c.name || 'Contact'}${c.phone ? ` — ${c.phone}` : ''}`
      ),
      appt.property?.title ? `🏠 ${appt.property.title}` : null,
      appt.location ? `📌 ${appt.location}\n🗺 ${mapsLink(appt.location)}` : null,
      appt.agenda ? `📋 *Agenda:* ${appt.agenda}` : null,
      '',
      '_Reply *today* for your full schedule._',
    ].filter((l): l is string => l !== null);

    const result = await sendWhatsAppMessageAndPersist({
      accountId: appt.account_id,
      userId: assigneeId,
      toPhone: assignee.phone,
      kind: 'text',
      senderType: 'bot',
      text: lines.join('\n'),
    });

    if (result.success) {
      await admin.from('appointments').update({ agent_reminder_sent: true }).eq('id', appt.id);
    } else {
      console.warn(`[Agent Reminder] send failed for appt ${appt.id}:`, result.error);
    }
  }
}

/** Morning digest, once per member per IST day, sent during the
 *  morning window. The agent_digest_log unique constraint is the
 *  claim — whoever inserts first sends; racing cron ticks skip. */
export async function sendDailyScheduleDigests(now: Date = new Date()): Promise<void> {
  const admin = supabaseAdmin();

  const istHour = istHourOf(now);
  if (istHour < 7 || istHour >= 11) return;

  const { startIso, endIso, label } = istDayWindow(now);

  const { data: appointments, error } = await admin
    .from('appointments')
    .select('id, account_id, user_id, assigned_to, title, event_type, start_time, location, status, contact:contacts(name)')
    .eq('status', 'scheduled')
    .gte('start_time', startIso)
    .lt('start_time', endIso)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('[Daily Digest] fetch failed:', error);
    return;
  }
  if (!appointments || appointments.length === 0) return;

  const { data: todos } = await admin
    .from('todos')
    .select('account_id, user_id, assigned_to, title, priority')
    .eq('completed', false)
    .gte('due_date', startIso)
    .lt('due_date', endIso);

  type DigestEvent = (typeof appointments)[number];
  type DigestTodo = NonNullable<typeof todos>[number];

  const byAccountUser = new Map<string, { accountId: string; userId: string; events: DigestEvent[]; todos: DigestTodo[] }>();
  const bucket = (accountId: string, userId: string) => {
    const key = `${accountId}:${userId}`;
    let entry = byAccountUser.get(key);
    if (!entry) {
      entry = { accountId, userId, events: [], todos: [] };
      byAccountUser.set(key, entry);
    }
    return entry;
  };

  for (const appt of appointments) {
    const uid = (appt.assigned_to || appt.user_id) as string | null;
    if (uid) bucket(appt.account_id as string, uid).events.push(appt);
  }
  for (const todo of todos || []) {
    const uid = (todo.assigned_to || todo.user_id) as string | null;
    if (uid) bucket(todo.account_id as string, uid).todos.push(todo);
  }

  const assignees = await loadAssigneePhones([...new Set([...byAccountUser.values()].map((b) => b.userId))]);
  const digestDate = startIso.substring(0, 10);

  for (const entry of byAccountUser.values()) {
    const assignee = assignees.get(entry.userId);
    if (!assignee) continue;

    const { error: claimErr } = await admin.from('agent_digest_log').insert({
      account_id: entry.accountId,
      user_id: entry.userId,
      digest_date: digestDate,
    });
    if (claimErr) {
      if (claimErr.code !== '23505') {
        console.error('[Daily Digest] claim failed:', claimErr);
      }
      continue;
    }

    const text =
      `☀️ Good morning${assignee.full_name ? `, ${assignee.full_name.split(' ')[0]}` : ''}!\n\n` +
      formatAgendaMessage(
        label,
        entry.events.map((e) => ({
          title: e.title as string,
          event_type: e.event_type as string | null,
          start_time: e.start_time as string,
          location: e.location as string | null,
          status: e.status as string,
          contact: e.contact as unknown as { name: string | null } | null,
        })),
        entry.todos.map((t) => ({ title: t.title as string, priority: t.priority as string }))
      );

    const result = await sendWhatsAppMessageAndPersist({
      accountId: entry.accountId,
      userId: entry.userId,
      toPhone: assignee.phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });
    if (!result.success) {
      console.warn(`[Daily Digest] send failed for user ${entry.userId}:`, result.error);
    }
  }
}

/** An event that ended >2h ago and is still "scheduled" gets one
 *  gentle accountability nudge to its assignee. */
export async function sendOverdueNudges(now: Date = new Date()): Promise<void> {
  const admin = supabaseAdmin();
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oldest = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const { data: appointments, error } = await admin
    .from('appointments')
    .select('id, account_id, user_id, assigned_to, title, event_type, start_time, end_time, location, contact:contacts(id, name, phone), property:properties(id, title, location)')
    .eq('status', 'scheduled')
    .eq('overdue_nudge_sent', false)
    .lt('end_time', cutoff.toISOString())
    .gt('end_time', oldest.toISOString());

  if (error) {
    console.error('[Overdue Nudge] fetch failed:', error);
    return;
  }
  if (!appointments || appointments.length === 0) return;

  const rows = appointments as unknown as ReminderAppointment[];
  const assignees = await loadAssigneePhones(
    [...new Set(rows.map((a) => a.assigned_to || a.user_id).filter(Boolean))] as string[]
  );

  for (const appt of rows) {
    const assigneeId = appt.assigned_to || appt.user_id;
    const assignee = assigneeId ? assignees.get(assigneeId) : undefined;

    // One attempt only — mark first so a send failure can't loop.
    await admin.from('appointments').update({ overdue_nudge_sent: true }).eq('id', appt.id);
    if (!assignee) continue;

    const emoji = EVENT_TYPE_EMOJI[appt.event_type || 'other'] || '🗓';
    const text = [
      `🤔 *How did it go?*`,
      `${emoji} ${appt.title}${appt.contact?.name ? ` with ${appt.contact.name}` : ''} was scheduled for ${istTime(appt.start_time)} and is still open.`,
      '',
      'Mark it *Completed* on the Calendar page and log the minutes / outcome while it\'s fresh — or reschedule it if it slipped.',
    ].join('\n');

    const result = await sendWhatsAppMessageAndPersist({
      accountId: appt.account_id,
      userId: assigneeId,
      toPhone: assignee.phone,
      kind: 'text',
      senderType: 'bot',
      text,
    });
    if (!result.success) {
      console.warn(`[Overdue Nudge] send failed for appt ${appt.id}:`, result.error);
    }
  }
}

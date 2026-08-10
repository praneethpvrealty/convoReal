// ============================================================
// The agent task digest — an agent's own open work, sent to them a
// few times a day instead of waiting to be looked up.
//
// Delivery goes through createNotification with the 'daily_digest'
// event key, so it lands in-app, on push, and on WhatsApp as FREE
// TEXT — no template, and therefore no category to be miscategorised
// and no per-user marketing cap to be silently dropped by. That
// matters here more than anywhere: a template sending three times a
// day is exactly the shape error 131049 eats, and the four attempts
// at an agent digest template recorded in AGENTS.md all came back
// Marketing. The agent is staff, not a lead — the account's own
// notification preferences decide the channels.
//
// Times are IST "HH:MM". Everything that decides WHETHER to send is a
// pure function below, so the scheduling can be tested without a
// clock, a database or a network.
// ============================================================

import { supabaseAdmin } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/create';

/** What the brokerage asked for: before the day, mid-day, after it. */
export const DEFAULT_SEND_TIMES = ['07:00', '13:00', '21:00'];

/** More than this in one day is a notification the agent will mute. */
const MAX_SEND_TIMES = 8;

/** Tasks listed in one digest. Past this it stops being a digest. */
const MAX_LISTED = 8;

export interface DigestTask {
  title: string;
  due_date: string | null;
  priority: string | null;
}

export interface DigestAppointment {
  title: string;
  start_time: string;
}

/**
 * Stored send times, made safe to schedule against.
 *
 * Anything that is not a real 24-hour "HH:MM" is dropped rather than
 * coerced: a bad value here does not mis-send, it silently changes
 * WHEN an agent is interrupted, so guessing at "7" or "25:00" is worse
 * than ignoring it. An empty result falls back to the defaults, so a
 * row corrupted by hand still produces a working schedule.
 */
export function normalizeSendTimes(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const valid = list
    .map((v) => String(v ?? '').trim())
    .filter((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
  const unique = [...new Set(valid)].sort();
  return unique.length ? unique.slice(0, MAX_SEND_TIMES) : [...DEFAULT_SEND_TIMES];
}

/** The IST calendar day and clock time of an instant. */
export function istNow(now: Date = new Date()): { date: string; hhmm: string } {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return { date, hhmm };
}

/**
 * The slot this run should send, or null.
 *
 * The latest configured time that has already passed today and has no
 * row in the ledger yet. Two properties fall out of that, and both are
 * the point:
 *
 * - a missed run catches up. The cron does not ask "is it 07:00 right
 *   now"; it asks which slots have passed unsent. A platform outage at
 *   07:00 still delivers at 07:30 rather than losing the slot.
 * - a backlog collapses. If 07:00 and 13:00 were both missed, the
 *   agent gets ONE digest at 13:00's content, not two at once — the
 *   later slot is the truer picture, and the earlier one is marked
 *   spent by the caller so it cannot fire afterwards.
 */
export function dueSlot(
  sendTimes: string[],
  nowHhmm: string,
  alreadySent: string[] = []
): string | null {
  const sent = new Set(alreadySent);
  const passed = sendTimes.filter((t) => t <= nowHhmm && !sent.has(t));
  return passed.length ? passed[passed.length - 1] : null;
}

/**
 * Slots earlier than the one being sent that were never sent.
 *
 * Claimed alongside it so a collapsed backlog cannot re-fire: without
 * this, sending 13:00 first would leave 07:00 still pending and the
 * next run half an hour later would deliver it as though the morning
 * had just happened.
 */
export function supersededSlots(
  sendTimes: string[],
  slot: string,
  alreadySent: string[] = []
): string[] {
  const sent = new Set(alreadySent);
  return sendTimes.filter((t) => t < slot && !sent.has(t));
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * The message. Returns null when there is nothing open — an agent with
 * a clear list should hear nothing at all, three times a day, rather
 * than "you have 0 tasks" three times a day.
 */
export function formatTaskDigest(input: {
  name?: string | null;
  slot: string;
  overdue: DigestTask[];
  dueToday: DigestTask[];
  appointments: DigestAppointment[];
}): { title: string; body: string } | null {
  const { overdue, dueToday, appointments } = input;
  if (!overdue.length && !dueToday.length && !appointments.length) return null;

  const first = input.name?.trim().split(/\s+/)[0];
  const heading =
    Number(input.slot.slice(0, 2)) < 12
      ? 'Your day'
      : Number(input.slot.slice(0, 2)) < 17
        ? 'Where your day stands'
        : 'Still open tonight';

  const lines: string[] = [];
  if (overdue.length) {
    lines.push(`⚠️ *Overdue (${overdue.length})*`);
    lines.push(...overdue.slice(0, MAX_LISTED).map((t) => `• ${t.title}`));
    if (overdue.length > MAX_LISTED) lines.push(`_+${overdue.length - MAX_LISTED} more_`);
    lines.push('');
  }
  if (dueToday.length) {
    lines.push(`📝 *Due today (${dueToday.length})*`);
    lines.push(...dueToday.slice(0, MAX_LISTED).map((t) => `• ${t.title}`));
    if (dueToday.length > MAX_LISTED) lines.push(`_+${dueToday.length - MAX_LISTED} more_`);
    lines.push('');
  }
  if (appointments.length) {
    lines.push(`🗓 *Today's calendar (${appointments.length})*`);
    lines.push(
      ...appointments
        .slice(0, MAX_LISTED)
        .map((a) => `• ${timeLabel(a.start_time)} — ${a.title}`)
    );
    lines.push('');
  }
  lines.push('_Reply *today* anytime to see your day\'s schedule._');

  return {
    title: first ? `${heading}, ${first}` : heading,
    body: lines.join('\n').trim(),
  };
}

export interface TaskDigestRunResult {
  agentsConsidered: number;
  sent: number;
  skippedEmpty: number;
  skippedNotDue: number;
}

/**
 * One pass over every agent whose digest is on. Safe to call as often
 * as the platform likes — the ledger insert is the claim, so a second
 * run in the same slot sends nothing.
 */
export async function sendAgentTaskDigests(
  now: Date = new Date()
): Promise<TaskDigestRunResult> {
  const db = supabaseAdmin();
  const result: TaskDigestRunResult = {
    agentsConsidered: 0,
    sent: 0,
    skippedEmpty: 0,
    skippedNotDue: 0,
  };

  const { data: settings, error } = await db
    .from('agent_task_digest_settings')
    .select('account_id, user_id, send_times')
    .eq('enabled', true);
  if (error) throw error;

  const { date: istDate, hhmm } = istNow(now);
  const dayStart = new Date(`${istDate}T00:00:00+05:30`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  for (const row of settings || []) {
    result.agentsConsidered += 1;
    const accountId = row.account_id as string;
    const userId = row.user_id as string;

    const { data: logRows } = await db
      .from('agent_task_digest_log')
      .select('slot')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .eq('digest_date', istDate);
    const alreadySent = (logRows || []).map((r) => r.slot as string);

    const times = normalizeSendTimes(row.send_times);
    const slot = dueSlot(times, hhmm, alreadySent);
    if (!slot) {
      result.skippedNotDue += 1;
      continue;
    }

    // Claim before sending. A crash after this point costs one digest;
    // a crash before it would send two.
    const claims = [slot, ...supersededSlots(times, slot, alreadySent)].map((s) => ({
      account_id: accountId,
      user_id: userId,
      digest_date: istDate,
      slot: s,
    }));
    const { error: claimErr } = await db.from('agent_task_digest_log').insert(claims);
    if (claimErr) {
      // 23505 — another runner took this slot. Not an error worth
      // raising: the digest is going out, just not from here.
      continue;
    }

    const [{ data: todos }, { data: appts }, { data: profile }] = await Promise.all([
      db
        .from('todos')
        .select('title, due_date, priority')
        .eq('account_id', accountId)
        .eq('completed', false)
        .or(`assigned_to.eq.${userId},and(assigned_to.is.null,user_id.eq.${userId})`)
        .lt('due_date', dayEnd.toISOString())
        .order('due_date', { ascending: true }),
      db
        .from('appointments')
        .select('title, start_time')
        .eq('account_id', accountId)
        .or(`assigned_to.eq.${userId},and(assigned_to.is.null,user_id.eq.${userId})`)
        .neq('status', 'cancelled')
        .gte('start_time', dayStart.toISOString())
        .lt('start_time', dayEnd.toISOString())
        .order('start_time', { ascending: true }),
      db.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
    ]);

    const open = (todos || []) as DigestTask[];
    const overdue = open.filter(
      (t) => t.due_date != null && new Date(t.due_date) < dayStart
    );
    const dueToday = open.filter(
      (t) => t.due_date == null || new Date(t.due_date) >= dayStart
    );

    const message = formatTaskDigest({
      name: (profile?.full_name as string | null) ?? null,
      slot,
      overdue,
      dueToday,
      appointments: (appts || []) as DigestAppointment[],
    });
    if (!message) {
      result.skippedEmpty += 1;
      continue;
    }

    await createNotification({
      accountId,
      userId,
      type: 'daily_digest',
      eventKey: 'daily_digest',
      title: message.title,
      body: message.body,
      link: '/today',
    });

    await db
      .from('agent_task_digest_log')
      .update({ task_count: overdue.length + dueToday.length })
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .eq('digest_date', istDate)
      .eq('slot', slot);

    result.sent += 1;
  }

  return result;
}

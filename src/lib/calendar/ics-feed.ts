export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 365;
export const FEED_MAX_ITEMS = 1000;
export const FEED_TOKEN_PREFIX = 'cvr_cal_';

const IST_OFFSET_MS = 330 * 60_000;
const DEFAULT_EVENT_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

export interface IcsEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  categories?: string | null;
  updated?: Date | null;
}

interface LinkedContact {
  name: string | null;
  phone: string | null;
}

interface LinkedProperty {
  title: string | null;
}

export interface FeedAppointment {
  id: string;
  title: string;
  description: string | null;
  agenda?: string | null;
  start_time: string;
  end_time: string | null;
  location: string | null;
  event_type?: string | null;
  updated_at?: string | null;
  contact?: LinkedContact | LinkedContact[] | null;
  property?: LinkedProperty | LinkedProperty[] | null;
}

export interface FeedTodo {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  priority: string | null;
  updated_at?: string | null;
  contact?: LinkedContact | LinkedContact[] | null;
  property?: LinkedProperty | LinkedProperty[] | null;
}

export const FEED_EVENT_TYPE_LABELS: Record<string, string> = {
  site_visit: 'Site visit',
  call: 'Call',
  follow_up: 'Follow-up',
  document: 'Document',
  meeting: 'Meeting',
  other: 'Other',
};

export function feedTokenFromParam(raw: string): string | null {
  const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw;
  if (!token.startsWith(FEED_TOKEN_PREFIX)) return null;
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  return token;
}

export function feedWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - FEED_PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + FEED_FUTURE_DAYS * DAY_MS),
  };
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatIcsUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function istDate(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}`;
}

function isIstMidnight(date: Date): boolean {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return (
    ist.getUTCHours() === 0 &&
    ist.getUTCMinutes() === 0 &&
    ist.getUTCSeconds() === 0
  );
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function linkedLines(
  contact: LinkedContact | null,
  property: LinkedProperty | null
): string[] {
  const lines: string[] = [];
  if (contact?.name || contact?.phone) {
    lines.push(
      `Contact: ${[contact.name, contact.phone].filter(Boolean).join(' · ')}`
    );
  }
  if (property?.title) lines.push(`Property: ${property.title}`);
  return lines;
}

function validDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function appointmentToIcsEvent(
  appointment: FeedAppointment,
  appUrl: string
): IcsEvent | null {
  const start = validDate(appointment.start_time);
  if (!start) return null;
  const end = validDate(appointment.end_time);
  const typeLabel = appointment.event_type
    ? FEED_EVENT_TYPE_LABELS[appointment.event_type]
    : undefined;
  const description = [
    typeLabel,
    ...linkedLines(first(appointment.contact), first(appointment.property)),
    appointment.agenda,
    appointment.description,
  ]
    .filter((line): line is string => !!line && line.trim().length > 0)
    .join('\n');
  return {
    uid: `appointment-${appointment.id}@convoreal`,
    summary: appointment.title,
    start,
    end:
      end && end.getTime() > start.getTime()
        ? end
        : new Date(start.getTime() + DEFAULT_EVENT_MS),
    description: description || null,
    location: appointment.location,
    url: `${appUrl}/calendar`,
    categories: typeLabel ?? null,
    updated: validDate(appointment.updated_at),
  };
}

export function todoToIcsEvent(
  todo: FeedTodo,
  appUrl: string
): IcsEvent | null {
  const due = validDate(todo.due_date);
  if (!due) return null;
  const allDay = isIstMidnight(due);
  const description = [
    todo.priority ? `Priority: ${todo.priority}` : null,
    ...linkedLines(first(todo.contact), first(todo.property)),
    todo.description,
  ]
    .filter((line): line is string => !!line && line.trim().length > 0)
    .join('\n');
  return {
    uid: `todo-${todo.id}@convoreal`,
    summary: `To-do: ${todo.title}`,
    start: due,
    end: allDay
      ? new Date(due.getTime() + DAY_MS)
      : new Date(due.getTime() + DEFAULT_EVENT_MS),
    allDay,
    description: description || null,
    url: `${appUrl}/calendar`,
    categories: 'To-do',
    updated: validDate(todo.updated_at),
  };
}

export function buildIcsCalendar(
  name: string,
  events: IcsEvent[],
  now: Date = new Date()
): string {
  const stamp = formatIcsUtc(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ConvoReal//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${stamp}`);
    if (event.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${istDate(event.start)}`,
        `DTEND;VALUE=DATE:${istDate(event.end)}`
      );
    } else {
      lines.push(
        `DTSTART:${formatIcsUtc(event.start)}`,
        `DTEND:${formatIcsUtc(event.end)}`
      );
    }
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    }
    if (event.categories) {
      lines.push(`CATEGORIES:${escapeIcsText(event.categories)}`);
    }
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.updated) {
      lines.push(`LAST-MODIFIED:${formatIcsUtc(event.updated)}`);
    }
    lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'email',
].join(' ');

export const GOOGLE_CALENDAR_NAME = 'ConvoReal';

export class GoogleCalendarApiError extends Error {
  readonly status: number;
  readonly reason?: string;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.status = status;
    this.reason = reason;
  }
}

export function isGoneError(err: unknown): boolean {
  return (
    err instanceof GoogleCalendarApiError &&
    (err.status === 404 || err.status === 410)
  );
}

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export function isConflictError(err: unknown): boolean {
  return err instanceof GoogleCalendarApiError && err.status === 409;
}

export interface GoogleEventBody {
  status: 'confirmed';
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  source?: { title: string; url: string };
  extendedProperties: { private: { convorealUid: string } };
}

async function request<T>(
  accessToken: string,
  url: string,
  init: { method: string; body?: unknown },
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let message = fallback;
    let reason: string | undefined;
    try {
      const data = (await res.json()) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };
      message = data.error?.message || fallback;
      reason = data.error?.errors?.[0]?.reason;
    } catch {
      reason = undefined;
    }
    throw new GoogleCalendarApiError(message, res.status, reason);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getGoogleEmail(
  accessToken: string
): Promise<string | null> {
  const data = await request<{ email?: string }>(
    accessToken,
    USERINFO_URL,
    { method: 'GET' },
    'Failed to read the Google account'
  );
  return data.email ?? null;
}

export async function createCalendar(accessToken: string): Promise<string> {
  const data = await request<{ id: string }>(
    accessToken,
    `${CALENDAR_API_BASE}/calendars`,
    {
      method: 'POST',
      body: { summary: GOOGLE_CALENDAR_NAME, timeZone: 'Asia/Kolkata' },
    },
    'Failed to create the ConvoReal calendar'
  );
  return data.id;
}

export async function calendarExists(
  accessToken: string,
  calendarId: string
): Promise<boolean> {
  try {
    await request(
      accessToken,
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}`,
      { method: 'GET' },
      'Failed to read the ConvoReal calendar'
    );
    return true;
  } catch (err) {
    if (isGoneError(err)) return false;
    throw err;
  }
}

export async function deleteCalendar(
  accessToken: string,
  calendarId: string
): Promise<void> {
  try {
    await request(
      accessToken,
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}`,
      { method: 'DELETE' },
      'Failed to remove a duplicate ConvoReal calendar'
    );
  } catch (err) {
    if (!isGoneError(err)) throw err;
  }
}

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody
): Promise<void> {
  await request(
    accessToken,
    eventsUrl(calendarId),
    { method: 'POST', body: { ...body, id: eventId } },
    'Failed to add the event to Google Calendar'
  );
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody
): Promise<void> {
  await request(
    accessToken,
    eventsUrl(calendarId, eventId),
    { method: 'PUT', body },
    'Failed to update the event in Google Calendar'
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  try {
    await request(
      accessToken,
      eventsUrl(calendarId, eventId),
      { method: 'DELETE' },
      'Failed to remove the event from Google Calendar'
    );
  } catch (err) {
    if (!isGoneError(err)) throw err;
  }
}

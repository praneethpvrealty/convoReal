import { createHash } from 'node:crypto';

import { istDate, type IcsEvent } from '@/lib/calendar/ics-feed';
import type { GoogleEventBody } from '@/lib/google-calendar/client';

export const SYNC_MAX_OPERATIONS = 150;

export function googleEventId(uid: string): string {
  return createHash('sha256').update(uid).digest('hex');
}

export interface DesiredEvent {
  uid: string;
  eventId: string;
  body: GoogleEventBody;
  hash: string;
  startsAt: string;
}

export interface EventLink {
  source_uid: string;
  google_event_id: string;
  content_hash: string;
  starts_at: string;
}

export interface SyncPlan {
  create: DesiredEvent[];
  update: Array<{ desired: DesiredEvent; link: EventLink }>;
  remove: EventLink[];
}

function isoDate(date: Date): string {
  const raw = istDate(date);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function toGoogleEvent(event: IcsEvent): GoogleEventBody {
  const description = [event.description, event.url]
    .filter((line): line is string => !!line)
    .join('\n\n');
  return {
    status: 'confirmed',
    summary: event.summary,
    ...(description ? { description } : {}),
    ...(event.location ? { location: event.location } : {}),
    start: event.allDay
      ? { date: isoDate(event.start) }
      : { dateTime: event.start.toISOString(), timeZone: 'Asia/Kolkata' },
    end: event.allDay
      ? { date: isoDate(event.end) }
      : { dateTime: event.end.toISOString(), timeZone: 'Asia/Kolkata' },
    ...(event.url ? { source: { title: 'ConvoReal', url: event.url } } : {}),
    extendedProperties: { private: { convorealUid: event.uid } },
  };
}

export function toDesiredEvent(event: IcsEvent): DesiredEvent {
  const body = toGoogleEvent(event);
  return {
    uid: event.uid,
    eventId: googleEventId(event.uid),
    body,
    hash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    startsAt: event.start.toISOString(),
  };
}

export function planSync(
  desired: DesiredEvent[],
  links: EventLink[],
  windowFrom: Date,
  maxOperations: number = SYNC_MAX_OPERATIONS
): SyncPlan {
  const linkByUid = new Map(links.map((link) => [link.source_uid, link]));
  const desiredUids = new Set(desired.map((event) => event.uid));
  const plan: SyncPlan = { create: [], update: [], remove: [] };
  let budget = maxOperations;

  for (const link of links) {
    if (budget <= 0) break;
    if (desiredUids.has(link.source_uid)) continue;
    if (new Date(link.starts_at).getTime() < windowFrom.getTime()) continue;
    plan.remove.push(link);
    budget -= 1;
  }
  for (const event of desired) {
    if (budget <= 0) break;
    const link = linkByUid.get(event.uid);
    if (!link) {
      plan.create.push(event);
      budget -= 1;
    } else if (link.content_hash !== event.hash) {
      plan.update.push({ desired: event, link });
      budget -= 1;
    }
  }
  return plan;
}

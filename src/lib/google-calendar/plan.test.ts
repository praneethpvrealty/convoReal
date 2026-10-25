import { describe, expect, it } from 'vitest';

import type { IcsEvent } from '@/lib/calendar/ics-feed';

import {
  planSync,
  toDesiredEvent,
  toGoogleEvent,
  type EventLink,
} from './plan';

const timed: IcsEvent = {
  uid: 'appointment-a@convoreal',
  summary: 'Site visit',
  start: new Date('2026-11-01T10:30:00Z'),
  end: new Date('2026-11-01T11:00:00Z'),
  description: 'Contact: Varun',
  location: 'JP Nagar',
  url: 'https://app.test/calendar',
};

const allDay: IcsEvent = {
  uid: 'todo-b@convoreal',
  summary: 'To-do: Collect cheque',
  start: new Date('2026-11-04T18:30:00Z'),
  end: new Date('2026-11-05T18:30:00Z'),
  allDay: true,
};

const windowFrom = new Date('2026-10-01T00:00:00Z');

function link(uid: string, hash: string, startsAt: string): EventLink {
  return {
    source_uid: uid,
    google_event_id: `g-${uid}`,
    content_hash: hash,
    starts_at: startsAt,
  };
}

describe('[CAL-015] Google Calendar sync plan', () => {
  it('[CAL-015] maps timed items to IST date-times and all-day to-dos to IST dates', () => {
    expect(toGoogleEvent(timed)).toMatchObject({
      summary: 'Site visit',
      location: 'JP Nagar',
      start: { dateTime: '2026-11-01T10:30:00.000Z', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-11-01T11:00:00.000Z', timeZone: 'Asia/Kolkata' },
      extendedProperties: { private: { convorealUid: timed.uid } },
    });
    expect(toGoogleEvent(allDay)).toMatchObject({
      start: { date: '2026-11-05' },
      end: { date: '2026-11-06' },
    });
  });

  it('[CAL-015] creates new items, updates changed ones and leaves unchanged ones alone', () => {
    const a = toDesiredEvent(timed);
    const b = toDesiredEvent(allDay);
    const plan = planSync(
      [a, b],
      [link(a.uid, 'stale', a.startsAt), link(b.uid, b.hash, b.startsAt)],
      windowFrom
    );
    expect(plan.create).toEqual([]);
    expect(plan.update.map((u) => u.desired.uid)).toEqual([a.uid]);
    expect(plan.remove).toEqual([]);
    expect(planSync([a], [], windowFrom).create.map((e) => e.uid)).toEqual([
      a.uid,
    ]);
  });

  it('[CAL-015] removes items that left the calendar but keeps events older than the window', () => {
    const gone = link(
      'appointment-gone@convoreal',
      'h',
      '2026-11-02T00:00:00Z'
    );
    const old = link('appointment-old@convoreal', 'h', '2026-09-01T00:00:00Z');
    const plan = planSync([], [gone, old], windowFrom);
    expect(plan.remove).toEqual([gone]);
  });

  it('[CAL-015] caps the operations of one run', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      toDesiredEvent({ ...timed, uid: `appointment-${i}@convoreal` })
    );
    const plan = planSync(many, [], windowFrom, 3);
    expect(plan.create).toHaveLength(3);
  });
});

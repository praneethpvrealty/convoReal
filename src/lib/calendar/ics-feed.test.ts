import { describe, expect, it } from 'vitest';

import {
  appointmentToIcsEvent,
  buildIcsCalendar,
  escapeIcsText,
  feedTokenFromParam,
  foldIcsLine,
  formatIcsUtc,
  todoToIcsEvent,
} from './ics-feed';

const APP = 'https://app.convoreal.com';
const TOKEN = `cvr_cal_${'a'.repeat(43)}`;

describe('[CAL-014] iCalendar feed', () => {
  it('[CAL-014] accepts only a well-formed feed token, with or without .ics', () => {
    expect(feedTokenFromParam(`${TOKEN}.ics`)).toBe(TOKEN);
    expect(feedTokenFromParam(TOKEN)).toBe(TOKEN);
    expect(feedTokenFromParam('cvr_sk_abc.ics')).toBeNull();
    expect(feedTokenFromParam('cvr_cal_short')).toBeNull();
    expect(feedTokenFromParam(`cvr_cal_${'a'.repeat(40)}%2F..`)).toBeNull();
  });

  it('[CAL-014] escapes text and folds long lines at 75 octets without splitting a character', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = foldIcsLine(`SUMMARY:${'₹'.repeat(40)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(
      folded
        .split('\r\n')
        .map((l, i) => (i ? l.slice(1) : l))
        .join('')
    ).toBe(`SUMMARY:${'₹'.repeat(40)}`);
  });

  it('[CAL-014] renders an appointment as a timed UTC event with its contact and property', () => {
    const event = appointmentToIcsEvent(
      {
        id: 'appt-1',
        title: 'Site visit, JP Nagar',
        description: null,
        agenda: 'Walk the plot',
        start_time: '2026-11-01T10:30:00.000Z',
        end_time: '2026-11-01T10:30:00.000Z',
        location: 'JP Nagar',
        event_type: 'site_visit',
        contact: [{ name: 'Varun', phone: '919800000000' }],
        property: { title: '30x40 plot' },
      },
      APP
    );
    expect(event).not.toBeNull();
    const ics = buildIcsCalendar(
      'ConvoReal',
      [event!],
      new Date('2026-10-25T00:00:00Z')
    ).replace(/\r\n /g, '');
    expect(ics).toContain('UID:appointment-appt-1@convoreal\r\n');
    expect(ics).toContain('DTSTART:20261101T103000Z\r\n');
    expect(ics).toContain('DTEND:20261101T110000Z\r\n');
    expect(ics).toContain('SUMMARY:Site visit\\, JP Nagar\r\n');
    expect(ics).toContain('Contact: Varun · 919800000000');
    expect(ics).toContain('Property: 30x40 plot');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('[CAL-014] renders a to-do due at IST midnight as an all-day event on its IST date', () => {
    const event = todoToIcsEvent(
      {
        id: 'todo-1',
        title: 'Collect cheque',
        description: null,
        due_date: '2026-11-04T18:30:00.000Z',
        priority: 'high',
      },
      APP
    );
    const ics = buildIcsCalendar('ConvoReal', [event!]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261105\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261106\r\n');
    expect(ics).toContain('SUMMARY:To-do: Collect cheque\r\n');
  });

  it('[CAL-014] renders a to-do with a time as a timed event', () => {
    const event = todoToIcsEvent(
      {
        id: 'todo-2',
        title: 'Call bank',
        description: null,
        due_date: '2026-11-04T05:00:00.000Z',
        priority: null,
      },
      APP
    );
    expect(event?.allDay).toBe(false);
    expect(formatIcsUtc(event!.start)).toBe('20261104T050000Z');
    expect(formatIcsUtc(event!.end)).toBe('20261104T053000Z');
  });

  it('[CAL-014] skips rows with an unusable date', () => {
    expect(
      todoToIcsEvent(
        {
          id: 't',
          title: 'x',
          description: null,
          due_date: 'nope',
          priority: null,
        },
        APP
      )
    ).toBeNull();
  });
});

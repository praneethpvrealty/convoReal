import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEND_TIMES,
  dueSlot,
  formatTaskDigest,
  istNow,
  normalizeSendTimes,
  supersededSlots,
} from './task-digest';

describe('normalizeSendTimes', () => {
  it('keeps valid times, sorted and deduped', () => {
    expect(normalizeSendTimes(['21:00', '07:00', '13:00', '07:00'])).toEqual([
      '07:00',
      '13:00',
      '21:00',
    ]);
  });

  it('drops anything that is not a real 24-hour time', () => {
    // Dropped rather than coerced: a bad value does not mis-send, it
    // changes WHEN somebody is interrupted, and guessing is worse.
    expect(normalizeSendTimes(['7', '25:00', '13:60', 'morning', '', null])).toEqual(
      DEFAULT_SEND_TIMES
    );
  });

  it('falls back to the defaults rather than scheduling nothing', () => {
    expect(normalizeSendTimes([])).toEqual(DEFAULT_SEND_TIMES);
    expect(normalizeSendTimes(null)).toEqual(DEFAULT_SEND_TIMES);
    expect(normalizeSendTimes('07:00')).toEqual(DEFAULT_SEND_TIMES);
  });

  it('accepts a schedule an agent trimmed to one', () => {
    expect(normalizeSendTimes(['08:30'])).toEqual(['08:30']);
  });
});

describe('dueSlot', () => {
  const times = ['07:00', '13:00', '21:00'];

  it('is null before the first slot of the day', () => {
    expect(dueSlot(times, '06:59')).toBeNull();
  });

  it('fires exactly at the configured minute', () => {
    expect(dueSlot(times, '07:00')).toBe('07:00');
  });

  it('does not re-send a slot already in the ledger', () => {
    expect(dueSlot(times, '09:30', ['07:00'])).toBeNull();
  });

  it('catches up a slot a missed run skipped', () => {
    // The cron does not ask "is it 07:00 now" — it asks what has passed
    // unsent, so an outage at 07:00 still delivers at 07:30.
    expect(dueSlot(times, '07:30', [])).toBe('07:00');
  });

  it('collapses a backlog to the latest slot, not one per slot', () => {
    // Both morning and midday missed: the agent gets 13:00's picture
    // once, not two digests back to back.
    expect(dueSlot(times, '13:05', [])).toBe('13:00');
  });

  it('moves on to the next slot once the earlier one is sent', () => {
    expect(dueSlot(times, '13:05', ['07:00'])).toBe('13:00');
    expect(dueSlot(times, '21:10', ['07:00', '13:00'])).toBe('21:00');
    expect(dueSlot(times, '23:59', ['07:00', '13:00', '21:00'])).toBeNull();
  });
});

describe('supersededSlots', () => {
  it('claims the slots a collapsed backlog skipped', () => {
    // Without this, sending 13:00 leaves 07:00 pending and the next run
    // half an hour later delivers the morning as though it just arrived.
    expect(supersededSlots(['07:00', '13:00', '21:00'], '13:00', [])).toEqual(['07:00']);
  });

  it('does not re-claim what the ledger already holds', () => {
    expect(supersededSlots(['07:00', '13:00', '21:00'], '13:00', ['07:00'])).toEqual([]);
  });

  it('is empty for the first slot of the day', () => {
    expect(supersededSlots(['07:00', '13:00'], '07:00', [])).toEqual([]);
  });
});

describe('istNow', () => {
  it('reads the IST calendar day, not the server\'s', () => {
    // 20:00 UTC is already the next day in IST (+05:30). A digest keyed
    // on the server's date would file the evening send under yesterday
    // and let the morning one repeat.
    expect(istNow(new Date('2026-08-10T20:00:00Z'))).toEqual({
      date: '2026-08-11',
      hhmm: '01:30',
    });
  });

  it('reads a working-hours instant correctly', () => {
    expect(istNow(new Date('2026-08-10T01:30:00Z'))).toEqual({
      date: '2026-08-10',
      hhmm: '07:00',
    });
  });
});

describe('formatTaskDigest', () => {
  const task = (title: string) => ({ title, due_date: null, priority: null });

  it('says nothing when there is nothing open', () => {
    // An agent with a clear list should hear silence three times a day,
    // not "you have 0 tasks" three times a day.
    expect(
      formatTaskDigest({ name: 'Praneeth', slot: '07:00', overdue: [], dueToday: [], appointments: [] })
    ).toBeNull();
  });

  it('leads with overdue work and counts each section', () => {
    const out = formatTaskDigest({
      name: 'Praneeth Kumar',
      slot: '07:00',
      overdue: [task('Send the EC to Ravi')],
      dueToday: [task('List SLV JP Nagar'), task('Call Ashwath')],
      appointments: [{ title: 'Site visit — Hoodi', start_time: '2026-08-10T05:30:00Z' }],
    });
    expect(out).not.toBeNull();
    expect(out!.title).toBe('Your day, Praneeth');
    expect(out!.body).toContain('Overdue (1)');
    expect(out!.body).toContain('Due today (2)');
    expect(out!.body).toContain("Today's calendar (1)");
    expect(out!.body).toContain('Send the EC to Ravi');
    expect(out!.body.indexOf('Overdue')).toBeLessThan(out!.body.indexOf('Due today'));
  });

  it('reads the time of day from the slot', () => {
    const args = { overdue: [], dueToday: [task('x')], appointments: [] };
    expect(formatTaskDigest({ ...args, slot: '07:00', name: null })!.title).toBe('Your day');
    expect(formatTaskDigest({ ...args, slot: '13:00', name: null })!.title).toBe(
      'Where your day stands'
    );
    expect(formatTaskDigest({ ...args, slot: '21:00', name: null })!.title).toBe(
      'Still open tonight'
    );
  });

  it('truncates a long list instead of sending a wall', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`Task ${i + 1}`));
    const out = formatTaskDigest({
      name: null,
      slot: '13:00',
      overdue: [],
      dueToday: many,
      appointments: [],
    });
    expect(out!.body).toContain('Due today (12)');
    expect(out!.body).toContain('+4 more');
    expect(out!.body).not.toContain('Task 12');
  });

  it('shows appointment times in IST', () => {
    const out = formatTaskDigest({
      name: null,
      slot: '07:00',
      overdue: [],
      dueToday: [],
      appointments: [{ title: 'Registration', start_time: '2026-08-10T05:30:00Z' }],
    });
    expect(out!.body).toContain('11:00 am');
  });
});

import { describe, it, expect } from 'vitest';
import {
  looksLikeSchedulingText,
  isAgendaCommand,
  formatAgendaMessage,
  istDayWindow,
} from './whatsapp-scheduler';

describe('looksLikeSchedulingText', () => {
  it('accepts explicit scheduling requests', () => {
    expect(looksLikeSchedulingText('Remind me to call Snigdha tomorrow at 5pm')).toBe(true);
    expect(looksLikeSchedulingText('Schedule site visit with Varun on Saturday')).toBe(true);
    expect(looksLikeSchedulingText('site visit at JP Nagar tomorrow 4pm')).toBe(true);
    expect(looksLikeSchedulingText('Follow up with Maltesh on the EC documents')).toBe(true);
    expect(looksLikeSchedulingText('task: send brochure to Rakesh')).toBe(true);
  });

  it('accepts verb + time-cue combinations', () => {
    expect(looksLikeSchedulingText('call varun tomorrow')).toBe(true);
    expect(looksLikeSchedulingText('meet the builder at 11am')).toBe(true);
  });

  it('rejects forwarded property listings', () => {
    expect(
      looksLikeSchedulingText(
        '3BHK flat for sale in JP Nagar, 1850 sqft, 1.2 crore, east facing, site visit welcome'
      )
    ).toBe(false);
    expect(looksLikeSchedulingText('2 BHK 1100 sqft rent 25000 HSR layout')).toBe(false);
  });

  it('rejects plain conversation and lead forwards', () => {
    expect(looksLikeSchedulingText('Rakesh is interested in the HSR flat, 9880011223')).toBe(false);
    expect(looksLikeSchedulingText('ok thanks')).toBe(false);
    expect(looksLikeSchedulingText('')).toBe(false);
  });

  it('still accepts an explicit "remind me" even with listing words', () => {
    expect(
      looksLikeSchedulingText('Remind me tomorrow to update the 3BHK 1850 sqft listing price to 1.3 crore')
    ).toBe(true);
  });
});

describe('isAgendaCommand', () => {
  it('matches agenda keywords case-insensitively', () => {
    expect(isAgendaCommand('today')).toBe(true);
    expect(isAgendaCommand('Agenda')).toBe(true);
    expect(isAgendaCommand("today's schedule")).toBe(true);
    expect(isAgendaCommand('my day')).toBe(true);
  });

  it('does not match longer sentences', () => {
    expect(isAgendaCommand('what am I doing today with Varun')).toBe(false);
  });
});

describe('formatAgendaMessage', () => {
  it('lists events in IST with type emoji and contact', () => {
    const msg = formatAgendaMessage(
      'Tuesday, 14 Jul',
      [
        {
          title: 'Site visit JP Nagar',
          event_type: 'site_visit',
          start_time: '2026-07-14T10:30:00.000Z', // 4:00 pm IST
          location: 'JP Nagar 5th Phase',
          status: 'scheduled',
          contact: { name: 'Varun' },
        },
      ],
      [{ title: 'Send EC to Snigdha', priority: 'high' }]
    );
    expect(msg).toContain('4:00 pm');
    expect(msg).toContain('Site visit JP Nagar');
    expect(msg).toContain('Varun');
    expect(msg).toContain('JP Nagar 5th Phase');
    expect(msg).toContain('Send EC to Snigdha');
    expect(msg).toContain('🔴');
  });

  it('has a friendly empty state', () => {
    const msg = formatAgendaMessage('Tuesday, 14 Jul', [], []);
    expect(msg).toContain('Nothing scheduled');
  });
});

describe('istDayWindow', () => {
  it('spans IST midnight to midnight', () => {
    // 2026-07-14 02:00 IST = 2026-07-13 20:30 UTC
    const { startIso, endIso, label } = istDayWindow(new Date('2026-07-13T20:30:00.000Z'));
    expect(startIso).toBe('2026-07-13T18:30:00.000Z'); // 14 Jul 00:00 IST
    expect(endIso).toBe('2026-07-14T18:30:00.000Z');
    expect(label).toContain('14');
  });
});

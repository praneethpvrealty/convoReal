import { describe, it, expect } from 'vitest';
import {
  isDigestDueToday,
  digestPeriod,
  hasUpdates,
  buildOwnerDigestSummaryLine,
  buildOwnerDigestMessage,
  parseOwnerDigestCommand,
  istHour,
  type OwnerDigest,
} from './owner-digest';

// 2026-07-13 was a Monday. 06:30 UTC = 12:00 IST.
const MONDAY = new Date('2026-07-13T06:30:00Z');
const TUESDAY = new Date('2026-07-14T06:30:00Z');

function digest(overrides?: Partial<OwnerDigest>): OwnerDigest {
  return {
    contactId: 'c1',
    name: 'Gopi Krishnan',
    properties: [
      {
        property_id: 'p1',
        title: 'Premium Commercial Property, Hoodi',
        inquiries: 3,
        shortlisted: 2,
        visits: 1,
        views: 24,
      },
      {
        property_id: 'p2',
        title: 'Vacant Plot, JP Nagar',
        inquiries: 0,
        shortlisted: 0,
        visits: 0,
        views: 0,
      },
    ],
    ...overrides,
  };
}

describe('isDigestDueToday', () => {
  it('daily digests are due every day', () => {
    expect(isDigestDueToday('daily', MONDAY)).toBe(true);
    expect(isDigestDueToday('daily', TUESDAY)).toBe(true);
  });

  it('weekly digests are due only on IST Mondays', () => {
    expect(isDigestDueToday('weekly', MONDAY)).toBe(true);
    expect(isDigestDueToday('weekly', TUESDAY)).toBe(false);
  });

  it('off is never due', () => {
    expect(isDigestDueToday('off', MONDAY)).toBe(false);
  });

  it('uses the IST calendar day, not UTC', () => {
    // Sunday 20:00 UTC = Monday 01:30 IST → weekly digest is due.
    const sundayUtcMondayIst = new Date('2026-07-12T20:00:00Z');
    expect(isDigestDueToday('weekly', sundayUtcMondayIst)).toBe(true);
  });
});

describe('digestPeriod', () => {
  it('covers 24 hours for daily and 7 days for weekly', () => {
    const daily = digestPeriod('daily', MONDAY);
    const weekly = digestPeriod('weekly', MONDAY);
    const day = 24 * 60 * 60 * 1000;
    expect(new Date(daily.endIso).getTime() - new Date(daily.startIso).getTime()).toBe(day);
    expect(new Date(weekly.endIso).getTime() - new Date(weekly.startIso).getTime()).toBe(7 * day);
    expect(daily.label).toBe('today');
    expect(weekly.label).toBe('this week');
  });

  it('stamps the IST date as the dedup key', () => {
    expect(digestPeriod('daily', MONDAY).digestDate).toBe('2026-07-13');
    // 20:00 UTC Sunday is already Monday in IST.
    expect(digestPeriod('daily', new Date('2026-07-12T20:00:00Z')).digestDate).toBe('2026-07-13');
  });
});

describe('istHour', () => {
  it('converts UTC to IST hours', () => {
    expect(istHour(new Date('2026-07-13T04:30:00Z'))).toBe(10);
    expect(istHour(new Date('2026-07-13T20:00:00Z'))).toBe(1); // 01:30 IST next day
  });
});

describe('hasUpdates', () => {
  it('is true when any property has any activity', () => {
    expect(hasUpdates(digest())).toBe(true);
  });

  it('is false when all counters are zero — digest must NOT be sent', () => {
    const quiet = digest({
      properties: digest().properties.map((p) => ({
        ...p,
        inquiries: 0,
        shortlisted: 0,
        visits: 0,
        views: 0,
      })),
    });
    expect(hasUpdates(quiet)).toBe(false);
  });
});

describe('buildOwnerDigestSummaryLine', () => {
  it('totals across properties and skips zero counters', () => {
    const line = buildOwnerDigestSummaryLine(digest());
    expect(line).toBe(
      '3 new enquiries · 2 buyers shortlisted · 1 site visit scheduled · 24 showcase views'
    );
  });

  it('uses singular forms', () => {
    const line = buildOwnerDigestSummaryLine(
      digest({
        properties: [
          {
            property_id: 'p1',
            title: 'T',
            inquiries: 1,
            shortlisted: 1,
            visits: 0,
            views: 1,
          },
        ],
      })
    );
    expect(line).toBe('1 new enquiry · 1 buyer shortlisted · 1 showcase view');
  });
});

describe('buildOwnerDigestMessage', () => {
  it('greets by first name and lists only properties with activity', () => {
    const msg = buildOwnerDigestMessage(digest(), 'this week');
    expect(msg).toContain('Hi Gopi');
    expect(msg).toContain('Premium Commercial Property, Hoodi');
    expect(msg).not.toContain('Vacant Plot, JP Nagar'); // zero activity
    expect(msg).toContain('• 3 new enquiries');
    expect(msg).toContain('• 2 buyers shortlisted');
    expect(msg).toContain('• 1 site visit scheduled');
    expect(msg).toContain('• 24 showcase views');
    expect(msg).toContain('STOP UPDATES');
  });
});

describe('parseOwnerDigestCommand', () => {
  it('matches stop/pause and start/resume phrasings', () => {
    expect(parseOwnerDigestCommand('STOP UPDATES')).toBe('stop');
    expect(parseOwnerDigestCommand('pause updates')).toBe('stop');
    expect(parseOwnerDigestCommand('stop property updates')).toBe('stop');
    expect(parseOwnerDigestCommand('Pause updates')).toBe('stop'); // template quick reply
    expect(parseOwnerDigestCommand('START UPDATES')).toBe('start');
    expect(parseOwnerDigestCommand('resume updates')).toBe('start');
  });

  it('ignores normal conversation', () => {
    expect(parseOwnerDigestCommand('please stop calling about updates')).toBeNull();
    expect(parseOwnerDigestCommand('stop')).toBeNull();
    expect(parseOwnerDigestCommand('any update?')).toBeNull();
    expect(parseOwnerDigestCommand(null)).toBeNull();
  });
});

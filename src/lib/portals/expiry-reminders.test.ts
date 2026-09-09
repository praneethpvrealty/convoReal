import { describe, expect, it } from 'vitest';
import {
  buildPortalExpiryReminderCopy,
  portalExpiryReminderSchedule,
} from './expiry-reminders';

const now = new Date('2026-09-09T06:00:00Z');

describe('portalExpiryReminderSchedule', () => {
  it('waits seven days before asking for a missing expiry date', () => {
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-09-03T08:00:00Z', expiresOn: null },
        now
      )
    ).toBeNull();
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-09-02T08:00:00Z', expiresOn: null },
        now
      )
    ).toMatchObject({
      key: 'missing-expiry:2026-09-09',
      kind: 'missing_expiry',
    });
  });

  it('uses a fresh weekly key while an expiry date stays missing', () => {
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-26T08:00:00Z', expiresOn: null },
        now
      )
    ).toMatchObject({ key: 'missing-expiry:2026-09-09' });
  });

  it('schedules reminders at seven, three and one day before expiry', () => {
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-16' },
        now
      )
    ).toMatchObject({ key: 'expiry:2026-09-16:before-7' });
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-12' },
        now
      )
    ).toMatchObject({ key: 'expiry:2026-09-12:before-3' });
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-10' },
        now
      )
    ).toMatchObject({ key: 'expiry:2026-09-10:before-1' });
  });

  it('uses expiry-day and weekly overdue reminder keys', () => {
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-09' },
        now
      )
    ).toMatchObject({
      key: 'expiry:2026-09-09:expiry-day',
      kind: 'expiry_day',
    });
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-07' },
        now
      )
    ).toMatchObject({
      key: 'expiry:2026-09-07:expiry-day',
      kind: 'overdue',
      daysOverdue: 2,
    });
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-02' },
        now
      )
    ).toMatchObject({
      key: 'expiry:2026-09-02:overdue-1',
      kind: 'overdue',
      daysOverdue: 7,
    });
  });

  it('does not schedule before the seven-day window', () => {
    expect(
      portalExpiryReminderSchedule(
        { postedAt: '2026-08-01T08:00:00Z', expiresOn: '2026-09-17' },
        now
      )
    ).toBeNull();
  });
});

describe('buildPortalExpiryReminderCopy', () => {
  it('summarises missing dates without sending one message per listing', () => {
    const reminders = [
      {
        listing: {
          id: 'listing-1',
          account_id: 'account-1',
          user_id: 'user-1',
          portal: 'magicbricks',
          listing_url: null,
          posted_at: '2026-08-01T08:00:00Z',
          expires_on: null,
          property: {
            id: 'property-1',
            title: 'Maple House',
            property_code: 'PROP-1',
          },
        },
        recipientUserId: 'user-1',
        schedule: {
          key: 'missing-expiry:2026-09-09',
          kind: 'missing_expiry' as const,
          dueOn: '2026-09-09',
          daysUntilExpiry: null,
          daysOverdue: null,
        },
      },
      {
        listing: {
          id: 'listing-2',
          account_id: 'account-1',
          user_id: 'user-1',
          portal: 'magicbricks',
          listing_url: null,
          posted_at: '2026-08-01T08:00:00Z',
          expires_on: null,
          property: {
            id: 'property-2',
            title: 'Lake View',
            property_code: 'PROP-2',
          },
        },
        recipientUserId: 'user-1',
        schedule: {
          key: 'missing-expiry:2026-09-09',
          kind: 'missing_expiry' as const,
          dueOn: '2026-09-09',
          daysUntilExpiry: null,
          daysOverdue: null,
        },
      },
    ];

    const copy = buildPortalExpiryReminderCopy('magicbricks', reminders);
    expect(copy.title).toBe('MagicBricks: 2 expiry dates missing');
    expect(copy.body).toContain('PROP-1 — Maple House — expiry date missing');
    expect(copy.body).toContain('PROP-2 — Lake View — expiry date missing');
  });
});

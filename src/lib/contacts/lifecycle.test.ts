import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isContactReachable,
  markContactDead,
  reviveContact,
} from './lifecycle';

/**
 * Closing an enquiry has to do more than mute alerts. Before migration
 * 228 "Close my enquiry" wrote only `buyer_alerts_consent = 'declined'`,
 * which excludes a contact from broadcast audiences and nothing else —
 * automations, digests, Radar, shares and the matching engine all
 * carried on messaging a lead who had said they were done.
 */

interface Write {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

function fakeDb() {
  const writes: Write[] = [];
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> = {};
      const builder = {
        update: (p: Record<string, unknown>) => {
          patch = p;
          return builder;
        },
        insert: (p: Record<string, unknown>) => {
          writes.push({ table, patch: p, filters: [] });
          return Promise.resolve({ data: null, error: null });
        },
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => {
          writes.push({ table, patch, filters });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const ARGS = { accountId: 'acc-1', contactId: 'contact-1' };

describe('markContactDead', () => {
  it('parks the requirement and stops alerts, not just alerts', async () => {
    const { db, writes } = fakeDb();

    await markContactDead({ ...ARGS, db, reason: 'closed_enquiry' });

    const update = writes.find((w) => w.table === 'contacts');
    expect(update?.patch).toMatchObject({
      is_dead: true,
      dead_reason: 'closed_enquiry',
      // The matcher already reads this to park a brief, so closing an
      // enquiry reuses it rather than adding a second way to say it.
      requirement_active: false,
      buyer_alerts_consent: 'declined',
    });
  });

  it('scopes the write to the account, never to the id alone', async () => {
    const { db, writes } = fakeDb();

    await markContactDead({ ...ARGS, db, reason: 'manual' });

    const update = writes.find((w) => w.table === 'contacts');
    expect(update?.filters).toEqual([
      ['id', 'contact-1'],
      ['account_id', 'acc-1'],
    ]);
  });

  it('records why, so the agent can see what happened', async () => {
    const { db, writes } = fakeDb();

    await markContactDead({
      ...ARGS,
      db,
      reason: 'closed_enquiry',
      note: 'Lead closed their enquiry from WhatsApp',
    });

    const note = writes.find((w) => w.table === 'contact_notes');
    expect(note?.patch).toMatchObject({
      contact_id: 'contact-1',
      account_id: 'acc-1',
      note_text: 'Lead closed their enquiry from WhatsApp',
    });
  });
});

describe('reviveContact', () => {
  it('restores the lead without restoring consent to message them', async () => {
    const { db, writes } = fakeDb();

    await reviveContact({ ...ARGS, db });

    const update = writes.find((w) => w.table === 'contacts');
    expect(update?.patch).toMatchObject({
      is_dead: false,
      dead_at: null,
      requirement_active: true,
    });
    // The lead opted out in their own words; an agent restoring the
    // record is not them changing their mind.
    expect(update?.patch).not.toHaveProperty('buyer_alerts_consent');
  });
});

describe('isContactReachable', () => {
  it('excludes dead and archived contacts', () => {
    expect(isContactReachable({})).toBe(true);
    expect(isContactReachable({ is_dead: false, is_archived: false })).toBe(
      true
    );
    expect(isContactReachable({ is_dead: true })).toBe(false);
    expect(isContactReachable({ is_archived: true })).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The approve flow's control flow, after the independent steps were
 * moved onto one Promise.all — the status flip, the drafted details and
 * the conversation lookup used to wait for each other, which was most of
 * the gap between the tap and the confirmation sheet.
 *
 * Supabase, the auth store and the send path are mocked so the module
 * loads under the plain Node runner.
 */

interface Recorded {
  table: string;
  op: string;
}

let recorded: Recorded[];
let updateError: { message: string } | null;
let existingConversation: { id: string } | null;
let propertyRow: Record<string, unknown> | null;
let sendOutcome: { sent: boolean; channel?: 'freeform' | 'template'; error?: string };

function builder(table: string) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    order: () => b,
    limit: () => b,
    insert: () => {
      recorded.push({ table, op: 'insert' });
      return b;
    },
    update: () => {
      recorded.push({ table, op: 'update' });
      return b;
    },
    maybeSingle: () => {
      recorded.push({ table, op: 'read' });
      if (table === 'properties') return Promise.resolve({ data: propertyRow, error: null });
      return Promise.resolve({ data: existingConversation, error: null });
    },
    single: () => Promise.resolve({ data: { id: 'conv-new' }, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: null,
        error: table === 'contacts' ? updateError : null,
      }).then(resolve),
  };
  return b;
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
  },
}));

vi.mock('./auth-store', () => ({
  useAuthStore: {
    getState: () => ({ profile: { account_id: 'acc-1' }, session: { user: { id: 'user-1' } } }),
  },
}));

vi.mock('./property-share-actions', () => ({
  sendPropertyViaEngine: async () => sendOutcome,
}));

vi.mock('./welcome-message', () => ({
  getShowcaseUrl: async () => 'https://showcase.test',
}));

import type { Contact } from './types';

const { approveAndSendDetails } = await import('./approve-contact');

const CONTACT: Contact = {
  id: 'contact-1',
  name: 'Veena Gupta',
  phone: '+919415224490',
  last_inquired_property_id: 'prop-1',
} as Contact;

beforeEach(() => {
  recorded = [];
  updateError = null;
  existingConversation = { id: 'conv-1' };
  propertyRow = { id: 'prop-1', title: '50x80 Residential Plot in BTM Layout' };
  sendOutcome = { sent: true, channel: 'freeform' };
});

describe('approveAndSendDetails', () => {
  it('flips the contact and reports how the details went out', async () => {
    const result = await approveAndSendDetails(CONTACT);

    expect(result).toMatchObject({ ok: true, sent: true, channel: 'freeform' });
    expect(recorded.some((r) => r.table === 'contacts' && r.op === 'update')).toBe(true);
  });

  it('surfaces a failed status flip instead of sending anyway', async () => {
    updateError = { message: 'row level security' };

    const result = await approveAndSendDetails(CONTACT);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('row level security');
  });

  it('still activates a contact that inquired about nothing, and touches no conversation', async () => {
    const result = await approveAndSendDetails({ ...CONTACT, last_inquired_property_id: null });

    expect(result).toMatchObject({ ok: true, sent: false });
    expect(recorded.some((r) => r.table === 'conversations')).toBe(false);
  });

  it('hands back the conversation for a template when the window has closed', async () => {
    sendOutcome = { sent: false, error: 'Re-engagement message: 24 hours' };

    const result = await approveAndSendDetails(CONTACT);

    expect(result).toMatchObject({ ok: true, sent: false, reengageConversationId: 'conv-1' });
    expect(result.detailsMessage).toContain('50x80 Residential Plot in BTM Layout');
  });

  it('reports a real send failure as an error, not a re-engagement fallback', async () => {
    sendOutcome = { sent: false, error: 'Contact phone invalid format' };

    const result = await approveAndSendDetails(CONTACT);

    expect(result.error).toBe('Contact phone invalid format');
    expect(result.reengageConversationId).toBeUndefined();
  });

  it('creates a conversation when the contact has none', async () => {
    existingConversation = null;

    await approveAndSendDetails(CONTACT);

    expect(recorded.some((r) => r.table === 'conversations' && r.op === 'insert')).toBe(true);
  });
});

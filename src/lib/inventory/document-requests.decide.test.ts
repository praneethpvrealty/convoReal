import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sent: Array<{ text?: string | null }> = [];

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async (args: { text?: string }) => {
    sent.push(args);
    return { success: true, messageId: `m-${sent.length}` };
  }),
}));

import { decideDocumentRequest } from './document-requests';

type Row = Record<string, unknown>;

function fakeAdmin(property: Row) {
  const updates: Array<{ table: string; patch: Row }> = [];
  const builder = (table: string) => {
    let patch: Row | null = null;
    const query = {
      select: () => query,
      eq: () => query,
      update: (next: Row) => {
        patch = next;
        updates.push({ table, patch: next });
        return query;
      },
      maybeSingle: async () =>
        table === 'properties'
          ? { data: property, error: null }
          : { data: patch ? { id: 'req-1' } : null, error: null },
    };
    return query;
  };
  return {
    admin: { from: builder } as unknown as SupabaseClient,
    updates,
  };
}

const request = {
  id: 'req-1',
  property_id: 'prop-1',
  account_id: 'acc-1',
  requester_name: 'Pavan',
  requester_phone: '+917353838484',
  requester_email: null,
  status: 'pending',
};

beforeEach(() => {
  sent.length = 0;
});

describe('[DOC-003] a decision records when it was made and what went out', () => {
  it('stamps decided_at on a rejection', async () => {
    const { admin, updates } = fakeAdmin({
      id: 'prop-1',
      title: 'Plot',
      property_code: null,
      documents: [],
    });
    await decideDocumentRequest({
      admin,
      request,
      decision: 'reject',
      actorUserId: 'user-1',
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.status).toBe('rejected');
    expect(typeof updates[0].patch.decided_at).toBe('string');
    expect(sent).toHaveLength(0);
  });

  it('stamps decided_at and share_sent_at when a document link goes out', async () => {
    const { admin, updates } = fakeAdmin({
      id: 'prop-1',
      title: 'Plot',
      property_code: 'PROP-1',
      documents: ['https://x/a.pdf'],
    });
    const result = await decideDocumentRequest({
      admin,
      request,
      decision: 'approve',
      actorUserId: 'user-1',
    });
    expect(result.delivered).toBe(true);
    expect(result.shareLink).toContain('/docs/');
    expect(updates[0].patch.status).toBe('approved');
    expect(typeof updates[0].patch.decided_at).toBe('string');
    expect(updates.some((u) => 'share_sent_at' in u.patch)).toBe(true);
    expect(sent[0].text).toContain('/docs/');
  });

  it('does not count a being-prepared note as a sent link', async () => {
    const { admin, updates } = fakeAdmin({
      id: 'prop-1',
      title: 'Plot',
      property_code: null,
      documents: [],
    });
    const result = await decideDocumentRequest({
      admin,
      request,
      decision: 'approve',
      actorUserId: 'user-1',
    });
    expect(result.delivered).toBe(false);
    expect(updates[0].patch.status).toBe('approved');
    expect(typeof updates[0].patch.decided_at).toBe('string');
    expect(updates.some((u) => 'share_sent_at' in u.patch)).toBe(false);
    expect(sent[0].text).toContain('still being prepared');
    expect(sent[0].text).not.toContain('/docs/');
  });
});

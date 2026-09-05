import { describe, it, expect, vi } from 'vitest';

const sendWhatsAppMessageAndPersistMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) =>
    sendWhatsAppMessageAndPersistMock(...args),
}));

import { processShareFeedbackFollowups } from './share-feedback';

const ACCOUNT_ID = 'acc-1';
const CONTACT_ID = 'contact-1';
const SHARE_ID = 'share-1';
const SHARE_CREATED_AT = new Date(Date.now() - 45 * 60 * 1000).toISOString();

type Row = Record<string, unknown>;

function makeDb(
  overrides: {
    lastCustomerMessageAt?: string | null;
    updates?: Row[];
  } = {}
) {
  const updates = overrides.updates ?? [];

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    let updatePayload: Row | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return b;
      },
      in: () => b,
      lte: () => b,
      gte: () => b,
      limit: () => b,
      update: (payload: Row) => {
        updatePayload = payload;
        return b;
      },
      maybeSingle: () => {
        if (table === 'conversations') {
          return Promise.resolve({
            data:
              overrides.lastCustomerMessageAt === undefined
                ? null
                : { last_customer_message_at: overrides.lastCustomerMessageAt },
            error: null,
          });
        }
        if (table === 'whatsapp_config') {
          return Promise.resolve({ data: { user_id: 'owner-1' }, error: null });
        }
        if (table === 'contacts') {
          return Promise.resolve({
            data: { name: 'Asha', preferred_language: 'en_US' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (table === 'property_shares') {
          if (updatePayload) {
            updates.push({ table, ...filters, ...updatePayload });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({
            data: [
              {
                id: SHARE_ID,
                account_id: ACCOUNT_ID,
                contact_id: CONTACT_ID,
                created_at: SHARE_CREATED_AT,
                contacts: { id: CONTACT_ID, name: 'Asha' },
              },
            ],
            error: null,
          }).then(resolve);
        }
        if (table === 'message_templates') {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return b;
  }

  return { from: (table: string) => builder(table), updates };
}

describe('processShareFeedbackFollowups', () => {
  it('never queries messages.contact_id/direction and sends when the buyer never replied', async () => {
    const db = makeDb({ lastCustomerMessageAt: null });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(1);
    expect(sendWhatsAppMessageAndPersistMock).toHaveBeenCalledTimes(1);
    expect(db.updates).toContainEqual(
      expect.objectContaining({
        table: 'property_shares',
        id: SHARE_ID,
        feedback_status: 'sent',
      })
    );
  });

  it('skips the share once the buyer has replied since it was created', async () => {
    const db = makeDb({
      lastCustomerMessageAt: new Date(
        Date.now() - 10 * 60 * 1000
      ).toISOString(),
    });

    const sent = await processShareFeedbackFollowups(db as never);

    expect(sent).toBe(0);
    expect(sendWhatsAppMessageAndPersistMock).not.toHaveBeenCalled();
    expect(db.updates).toContainEqual(
      expect.objectContaining({
        table: 'property_shares',
        id: SHARE_ID,
        feedback_status: 'skipped',
      })
    );
  });
});

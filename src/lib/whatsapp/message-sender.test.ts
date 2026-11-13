import { describe, expect, it } from 'vitest';
import { messageSenderLabel, resolveMessageSender } from './message-sender';

type Filters = Record<string, unknown>;

function makeDb(profiles: Record<string, string>, owner: string | null) {
  return {
    from(table: string) {
      const filters: Filters = {};
      const b = {
        select: () => b,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table === 'accounts') {
            return { data: { name: 'Aryavarta Ventures' }, error: null };
          }
          if (filters.account_role === 'owner') {
            return { data: owner ? { full_name: owner } : null, error: null };
          }
          const name = profiles[String(filters.user_id)];
          return { data: name ? { full_name: name } : null, error: null };
        },
      };
      return b;
    },
  };
}

describe('resolveMessageSender', () => {
  it('names the first candidate who is a member, then the account owner', async () => {
    const db = makeDb({ 'agent-2': 'Meera Rao' }, 'Praneeth PV');
    expect(
      await resolveMessageSender(db as never, 'acc-1', [
        null,
        'agent-1',
        'agent-2',
      ])
    ).toEqual({ agentName: 'Meera Rao', brandName: 'Aryavarta Ventures' });
    expect(await resolveMessageSender(db as never, 'acc-1', [])).toEqual({
      agentName: 'Praneeth PV',
      brandName: 'Aryavarta Ventures',
    });
  });

  it('uses a brand name the caller already loaded', async () => {
    const db = makeDb({}, null);
    expect(
      await resolveMessageSender(db as never, 'acc-1', [], 'Acme Realty')
    ).toEqual({ agentName: null, brandName: 'Acme Realty' });
  });
});

describe('messageSenderLabel', () => {
  it('reads "agent from firm" in the template language', () => {
    const sender = { agentName: 'Ravi', brandName: 'Aryavarta Ventures' };
    expect(messageSenderLabel(sender, 'en_US')).toBe(
      'Ravi from Aryavarta Ventures'
    );
    expect(messageSenderLabel(sender, 'hi')).toBe('Aryavarta Ventures से Ravi');
  });

  it('falls back to whichever name it has', () => {
    expect(
      messageSenderLabel({ agentName: null, brandName: 'Acme Realty' })
    ).toBe('Acme Realty');
    expect(messageSenderLabel({ agentName: 'Ravi', brandName: null })).toBe(
      'Ravi'
    );
  });
});

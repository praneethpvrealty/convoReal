import { describe, it, expect } from 'vitest';

import { loadPastEnquiryContacts } from './past-enquiry';

// Two live buyers a week from registration were carded as "quiet for
// 28 days" and sent a check-in telling them their enquiry was still
// open — a message whose "Close my enquiry" button marks the contact
// dead. These pin the join that keeps the radar off a deal in flight.

type Row = Record<string, unknown>;

interface Filter {
  op: string;
  column: string;
  value: unknown;
}

/** Records every filter so a test can assert on scoping, and applies
 *  eq/in itself so a dropped item or another account's row is really
 *  excluded rather than excluded by the fixture. */
function db(tables: Record<string, Row[]>, seen: Filter[] = []) {
  return {
    from: (table: string) => {
      let rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          seen.push({ op: 'eq', column, value });
          rows = rows.filter((r) => r[column] === value);
          return chain;
        },
        in: (column: string, value: unknown[]) => {
          seen.push({ op: 'in', column, value });
          rows = rows.filter((r) => value.includes(r[column]));
          return chain;
        },
      };
      (chain as { then: unknown }).then = (
        resolve: (v: { data: unknown }) => void
      ) => resolve({ data: rows });
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const stages = [
  {
    id: 's-shared',
    account_id: 'a1',
    name: 'Shared',
    stage_kind: 'prospecting',
  },
  {
    id: 's-legal',
    account_id: 'a1',
    name: 'Token & Legal',
    stage_kind: 'closing',
  },
  { id: 's-paid', account_id: 'a1', name: 'Brokerage Paid', stage_kind: 'won' },
];

describe('loadPastEnquiryContacts', () => {
  it('names the closing stage a contact is sitting on', async () => {
    const found = await loadPastEnquiryContacts(
      db({
        journey_stages: stages,
        journey_items: [
          {
            account_id: 'a1',
            contact_id: 'ravi',
            stage_id: 's-legal',
            status: 'active',
          },
        ],
      }),
      'a1'
    );
    expect(found.get('ravi')).toBe('Token & Legal');
  });

  it('counts a won deal as past the enquiry too', async () => {
    const found = await loadPastEnquiryContacts(
      db({
        journey_stages: stages,
        journey_items: [
          {
            account_id: 'a1',
            contact_id: 'pruthvi',
            stage_id: 's-paid',
            status: 'active',
          },
        ],
      }),
      'a1'
    );
    expect(found.get('pruthvi')).toBe('Brokerage Paid');
  });

  it('leaves a prospecting lead in the radar', async () => {
    const found = await loadPastEnquiryContacts(
      db({
        journey_stages: stages,
        journey_items: [
          {
            account_id: 'a1',
            contact_id: 'hari',
            stage_id: 's-shared',
            status: 'active',
          },
        ],
      }),
      'a1'
    );
    expect(found.size).toBe(0);
  });

  it('ignores a dropped item — that deal is over, not in flight', async () => {
    const found = await loadPastEnquiryContacts(
      db({
        journey_stages: stages,
        journey_items: [
          {
            account_id: 'a1',
            contact_id: 'ravi',
            stage_id: 's-legal',
            status: 'dropped',
          },
        ],
      }),
      'a1'
    );
    expect(found.size).toBe(0);
  });

  it('scopes both queries to the account when given one', async () => {
    const seen: Filter[] = [];
    await loadPastEnquiryContacts(
      db(
        {
          journey_stages: stages,
          journey_items: [
            {
              account_id: 'a2',
              contact_id: 'someone-else',
              stage_id: 's-legal',
              status: 'active',
            },
          ],
        },
        seen
      ),
      'a1'
    );
    expect(
      seen.filter((f) => f.op === 'eq' && f.column === 'account_id')
    ).toHaveLength(2);
  });

  it('holds nobody back when the account has marked no closing stage', async () => {
    const found = await loadPastEnquiryContacts(
      db({
        journey_stages: [stages[0]],
        journey_items: [
          {
            account_id: 'a1',
            contact_id: 'ravi',
            stage_id: 's-legal',
            status: 'active',
          },
        ],
      }),
      'a1'
    );
    expect(found.size).toBe(0);
  });
});

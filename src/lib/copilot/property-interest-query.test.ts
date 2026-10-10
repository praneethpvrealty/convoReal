import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findCopilotPropertyInterest } from './property-interest-query';
import { parsePropertyInterestQuestion } from './property-interest';

const NOW = new Date('2026-10-10T06:00:00Z');
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';

interface TableStub {
  rows: unknown[];
  calls: Array<[string, unknown[]]>;
}

function clientWith(tables: Record<string, unknown[]>, rpcRows: unknown[]) {
  const stubs = new Map<string, TableStub>();
  const from = vi.fn((table: string) => {
    const stub: TableStub = { rows: tables[table] ?? [], calls: [] };
    stubs.set(table, stub);
    const builder: Record<string, unknown> = {};
    const chain = (name: string) =>
      vi.fn((...args: unknown[]) => {
        stub.calls.push([name, args]);
        return builder;
      });
    for (const name of [
      'select',
      'eq',
      'is',
      'or',
      'in',
      'ilike',
      'order',
      'limit',
    ]) {
      builder[name] = chain(name);
    }
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: stub.rows, error: null }).then(resolve);
    return builder;
  });
  const rpc = vi.fn().mockResolvedValue({ data: rpcRows, error: null });
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, stubs };
}

const interestRow = {
  property_id: PROPERTY_ID,
  property_title: 'Prime Corner Commercial Plot for Sale',
  property_code: 'PROP-1023',
  contact_id: '11111111-1111-4111-8111-111111111111',
  name: 'Ramesh',
  second_name: null,
  company: null,
  classification: 'Buyer',
  enquired: true,
  views_count: '2',
  shortlisted: false,
  visited: false,
  liked: false,
  journey_stage: 'Shortlist',
  journey_status: 'dropped',
  last_at: '2026-10-08T10:00:00Z',
  total: '5',
};

describe('findCopilotPropertyInterest', () => {
  it('[CPL-004] resolves the owner by name, their listings, then asks the account-scoped function', async () => {
    const { client, rpc, stubs } = clientWith(
      {
        contacts: [
          {
            id: OWNER_ID,
            name: 'Adithi',
            second_name: null,
            company: null,
            classification: 'Owner',
          },
        ],
        properties: [
          {
            id: PROPERTY_ID,
            title: 'Prime Corner Commercial Plot for Sale',
            property_code: 'PROP-1023',
            owner: { name: 'Adithi', second_name: null },
          },
        ],
      },
      [interestRow]
    );
    const query = parsePropertyInterestQuestion(
      "List out all the buyers who had showed interest in Adithi's property",
      [],
      NOW
    )!;

    const result = await findCopilotPropertyInterest(
      { supabase: client, accountId: 'acct-1' },
      query
    );

    expect(stubs.get('contacts')?.calls).toContainEqual([
      'ilike',
      ['copilot_search_text', '%adithi%'],
    ]);
    expect(stubs.get('contacts')?.calls).toContainEqual([
      'eq',
      ['account_id', 'acct-1'],
    ]);
    expect(stubs.get('properties')?.calls).toContainEqual([
      'in',
      ['owner_contact_id', [OWNER_ID]],
    ]);
    expect(stubs.get('properties')?.calls).toContainEqual([
      'or',
      ['listing_source.is.null,listing_source.neq.agent'],
    ]);
    expect(stubs.get('properties')?.calls).toContainEqual([
      'eq',
      ['account_id', 'acct-1'],
    ]);
    expect(rpc).toHaveBeenCalledWith('copilot_property_interest', {
      p_account_id: 'acct-1',
      p_property_ids: [PROPERTY_ID],
      p_contact_ids: [],
      p_since: null,
      p_signal: 'any',
      p_limit: 6,
    });
    expect(result.properties).toEqual([
      {
        id: PROPERTY_ID,
        title: 'Prime Corner Commercial Plot for Sale',
        code: 'PROP-1023',
        ownerName: 'Adithi',
      },
    ]);
    expect(result.total).toBe(5);
    expect(result.matches[0]).toMatchObject({
      contactId: '11111111-1111-4111-8111-111111111111',
      label: 'Ramesh',
      enquired: true,
      viewsCount: 2,
      journeyStage: 'Shortlist',
      journeyStatus: 'dropped',
    });
  });

  it('[CPL-004] returns no matches without a database call when no listing is found', async () => {
    const { client, rpc } = clientWith({ contacts: [], properties: [] }, []);
    const result = await findCopilotPropertyInterest(
      { supabase: client, accountId: 'acct-1' },
      parsePropertyInterestQuestion("who enquired about Zara's flat", [], NOW)!
    );
    expect(result).toEqual({
      properties: [],
      contacts: [],
      matches: [],
      total: 0,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('[CPL-004] passes the window alone for "who enquired today"', async () => {
    const { client, rpc } = clientWith({}, [interestRow]);
    const query = parsePropertyInterestQuestion('who enquired today', [], NOW)!;
    const result = await findCopilotPropertyInterest(
      { supabase: client, accountId: 'acct-1' },
      query
    );
    expect(rpc).toHaveBeenCalledWith('copilot_property_interest', {
      p_account_id: 'acct-1',
      p_property_ids: [],
      p_contact_ids: [],
      p_since: '2026-10-09T18:30:00.000Z',
      p_signal: 'enquired',
      p_limit: 6,
    });
    expect(result.matches).toHaveLength(1);
  });

  it('[CPL-004] resolves the contact for the reverse question and surfaces the function error', async () => {
    const { client, rpc } = clientWith(
      {
        contacts: [
          {
            id: 'c1',
            name: 'Ramesh Kumar',
            second_name: null,
            company: null,
            classification: 'Buyer',
          },
        ],
      },
      []
    );
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(
      findCopilotPropertyInterest(
        { supabase: client, accountId: 'acct-1' },
        parsePropertyInterestQuestion(
          'what properties did Ramesh enquire about',
          [],
          NOW
        )!
      )
    ).rejects.toThrow('boom');
    expect(rpc).toHaveBeenCalledWith(
      'copilot_property_interest',
      expect.objectContaining({
        p_property_ids: [],
        p_contact_ids: ['c1'],
        p_signal: 'enquired',
      })
    );
  });
});

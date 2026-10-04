import { describe, expect, it } from 'vitest';
import type { TypedSupabaseClient } from '@/lib/supabase/database';

import {
  findContactByName,
  findContactByPhoneVariants,
  findContactEnrichmentFields,
  findContactIdentityById,
  findContactNameById,
  findReferrerContacts,
  insertContact,
  insertContactNotes,
  insertContacts,
  insertContactTags,
  insertTag,
  listContactsByPhoneVariants,
  listTagIdNames,
  listUnmergedContactsForLinking,
  updateContactEnrichment,
  type PhoneVariants,
} from './owner-contacts';

type Op = 'select' | 'update' | 'insert';
type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

interface Call {
  table: string;
  op: Op;
  columns?: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
  returning: boolean;
  terminal: 'single' | 'maybeSingle' | 'list';
}

function stubClient(respond: (call: Call) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = {
        table,
        op: 'select',
        filters: [],
        returning: false,
        terminal: 'list',
      };
      let opSet = false;
      calls.push(call);
      const finish = (terminal: Call['terminal']) => {
        call.terminal = terminal;
        return Promise.resolve(respond(call));
      };
      const chain = {
        select: (columns?: string) => {
          if (opSet) {
            call.returning = true;
            call.columns = columns;
          } else {
            opSet = true;
            call.columns = columns;
          }
          return chain;
        },
        update: (payload: unknown) => {
          opSet = true;
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
        insert: (payload: unknown) => {
          opSet = true;
          call.op = 'insert';
          call.payload = payload;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return chain;
        },
        ilike: (column: string, value: unknown) => {
          call.filters.push([`${column} ilike`, value]);
          return chain;
        },
        or: (expression: string) => {
          call.filters.push(['or', expression]);
          return chain;
        },
        single: () => finish('single'),
        maybeSingle: () => finish('maybeSingle'),
        then: (
          onFulfilled: (value: Result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => finish('list').then(onFulfilled, onRejected),
      };
      return chain;
    },
  };
  return { client: client as unknown as TypedSupabaseClient, calls };
}

const ok = (data: unknown): Result => ({ data, error: null });
const failure = { code: '42501', message: 'denied' };
const failed: Result = { data: null, error: failure };

const PHONES: PhoneVariants = {
  rawPhone: '+91 98765 43210',
  normalized: '+919876543210',
  cleanPhone: '919876543210',
};
const PHONE_FILTER =
  'phone.eq."+91 98765 43210",phone.eq.+919876543210,phone.eq.919876543210';

describe('contact lookups by phone variants', () => {
  it('finds one contact in the account across the three phone spellings', async () => {
    const row = { id: 'c1', name: 'Asha' };
    const { client, calls } = stubClient(() => ok(row));

    const result = await findContactByPhoneVariants(client, 'a1', PHONES);

    expect(result).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'id, name',
        filters: [
          ['account_id', 'a1'],
          ['or', PHONE_FILTER],
        ],
        returning: false,
        terminal: 'maybeSingle',
      },
    ]);
  });

  it('escapes quotes and backslashes in the raw phone', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await findContactByPhoneVariants(client, 'a1', {
      ...PHONES,
      rawPhone: '9"8\\7',
    });

    expect(calls[0].filters[1]).toEqual([
      'or',
      'phone.eq."9\\"8\\\\7",phone.eq.+919876543210,phone.eq.919876543210',
    ]);
  });

  it('stringifies a missing raw phone the way the inline query did', async () => {
    const { client, calls } = stubClient(() => ok(null));

    await findContactByPhoneVariants(client, 'a1', {
      ...PHONES,
      rawPhone: undefined,
    });

    expect(calls[0].filters[1]).toEqual([
      'or',
      'phone.eq."undefined",phone.eq.+919876543210,phone.eq.919876543210',
    ]);
  });

  it('passes a read error through with no data', async () => {
    const { client } = stubClient(() => failed);

    const result = await findContactByPhoneVariants(client, 'a1', PHONES);

    expect(result).toEqual({ data: null, error: failure });
  });

  it('lists every matching contact with the classification column', async () => {
    const rows = [{ id: 'c1', name: 'Asha', classification: 'Agent' }];
    const { client, calls } = stubClient(() => ok(rows));

    const result = await listContactsByPhoneVariants(client, 'a1', PHONES);

    expect(result).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'id, name, classification',
        filters: [
          ['account_id', 'a1'],
          ['or', PHONE_FILTER],
        ],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('passes a list error through', async () => {
    const { client } = stubClient(() => failed);

    const result = await listContactsByPhoneVariants(client, 'a1', PHONES);

    expect(result).toEqual({ data: null, error: failure });
  });
});

describe('contact lookups by name and id', () => {
  it('finds a contact by case-insensitive name inside the account', async () => {
    const row = { id: 'c1', name: 'Asha' };
    const { client, calls } = stubClient(() => ok(row));

    const result = await findContactByName(client, 'a1', 'Asha');

    expect(result).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'id, name',
        filters: [
          ['account_id', 'a1'],
          ['name ilike', 'Asha'],
        ],
        returning: false,
        terminal: 'maybeSingle',
      },
    ]);
  });

  it('reads a contact name by id scoped to the account', async () => {
    const { client, calls } = stubClient(() => ok({ name: 'Asha' }));

    const result = await findContactNameById(client, 'a1', 'c1');

    expect(result).toEqual({ data: { name: 'Asha' }, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'name',
        filters: [
          ['id', 'c1'],
          ['account_id', 'a1'],
        ],
        returning: false,
        terminal: 'maybeSingle',
      },
    ]);
  });

  it('reads a contact identity by id scoped to the account', async () => {
    const row = { id: 'c1', name: 'Asha', phone: '+919876543210' };
    const { client, calls } = stubClient(() => ok(row));

    const result = await findContactIdentityById(client, 'a1', 'c1');

    expect(result).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'id, name, phone',
        filters: [
          ['id', 'c1'],
          ['account_id', 'a1'],
        ],
        returning: false,
        terminal: 'maybeSingle',
      },
    ]);
  });

  it('returns null data when the contact is not in the account', async () => {
    const { client } = stubClient(() => ok(null));

    expect(await findContactIdentityById(client, 'a1', 'c9')).toEqual({
      data: null,
      error: null,
    });
    expect(await findContactNameById(client, 'a1', 'c9')).toEqual({
      data: null,
      error: null,
    });
  });
});

describe('contact book read', () => {
  it('lists the unmerged contacts of the account', async () => {
    const rows = [{ id: 'c1', name: 'Asha', phone: '+919876543210' }];
    const { client, calls } = stubClient(() => ok(rows));

    const result = await listUnmergedContactsForLinking(client, 'a1');

    expect(result).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'id, name, phone',
        filters: [
          ['account_id', 'a1'],
          ['is_merged', false],
        ],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('passes a read error through', async () => {
    const { client } = stubClient(() => failed);

    const result = await listUnmergedContactsForLinking(client, 'a1');

    expect(result).toEqual({ data: null, error: failure });
  });
});

describe('contact enrichment', () => {
  it('reads the enrichable fields of a contact inside the account', async () => {
    const row = {
      email: null,
      company: 'Acme',
      name_tag: null,
      requirements: null,
    };
    const { client, calls } = stubClient(() => ok(row));

    const result = await findContactEnrichmentFields(client, 'a1', 'c1');

    expect(result).toEqual({ data: row, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'email, company, name_tag, requirements',
        filters: [
          ['id', 'c1'],
          ['account_id', 'a1'],
        ],
        returning: false,
        terminal: 'maybeSingle',
      },
    ]);
  });

  it('updates only the patch, scoped to the contact and account', async () => {
    const { client, calls } = stubClient(() => ok(null));

    const result = await updateContactEnrichment(client, 'a1', 'c1', {
      email: 'asha@example.com',
      requirements: '3 BHK',
    });

    expect(result).toEqual({ error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'update',
        payload: { email: 'asha@example.com', requirements: '3 BHK' },
        filters: [
          ['id', 'c1'],
          ['account_id', 'a1'],
        ],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('returns the update error instead of throwing', async () => {
    const { client } = stubClient(() => failed);

    const result = await updateContactEnrichment(client, 'a1', 'c1', {
      company: 'Acme',
    });

    expect(result).toEqual({ error: failure });
  });
});

describe('referrer lookup', () => {
  it('matches on any phone spelling or the name when a phone is given', async () => {
    const rows = [{ id: 'c2', name: 'Ravi' }];
    const { client, calls } = stubClient(() => ok(rows));

    const result = await findReferrerContacts(client, 'a1', 'Ravi', PHONES);

    expect(result).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'select',
        columns: 'id, name',
        filters: [
          ['account_id', 'a1'],
          ['or', `${PHONE_FILTER},name.ilike."Ravi"`],
        ],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('escapes the referrer name inside the or expression', async () => {
    const { client, calls } = stubClient(() => ok([]));

    await findReferrerContacts(client, 'a1', 'Ra"vi\\', PHONES);

    expect(calls[0].filters[1]).toEqual([
      'or',
      `${PHONE_FILTER},name.ilike."Ra\\"vi\\\\"`,
    ]);
  });

  it('matches on the name alone when there is no phone', async () => {
    const { client, calls } = stubClient(() => ok([]));

    await findReferrerContacts(client, 'a1', 'Ravi', null);

    expect(calls[0].filters).toEqual([
      ['account_id', 'a1'],
      ['name ilike', 'Ravi'],
    ]);
    expect(calls[0].terminal).toBe('list');
  });

  it('passes an error through', async () => {
    const { client } = stubClient(() => failed);

    const result = await findReferrerContacts(client, 'a1', 'Ravi', null);

    expect(result).toEqual({ data: null, error: failure });
  });
});

describe('contact inserts', () => {
  it('inserts one contact and returns the created row', async () => {
    const created = { id: 'c1' };
    const { client, calls } = stubClient(() => ok(created));
    const row = {
      account_id: 'a1',
      user_id: 'u1',
      name: 'Asha',
      phone: '+919876543210',
    };

    const result = await insertContact(client, row);

    expect(result).toEqual({ data: created, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'insert',
        payload: row,
        columns: undefined,
        filters: [],
        returning: true,
        terminal: 'single',
      },
    ]);
  });

  it('returns the insert error for a single contact', async () => {
    const { client } = stubClient(() => failed);

    const result = await insertContact(client, {
      account_id: 'a1',
      user_id: 'u1',
    });

    expect(result).toEqual({ data: null, error: failure });
  });

  it('inserts many contacts and returns every created row', async () => {
    const created = [{ id: 'c1' }, { id: 'c2' }];
    const { client, calls } = stubClient(() => ok(created));
    const rows = [
      { account_id: 'a1', user_id: 'u1', name: 'Asha' },
      { account_id: 'a1', user_id: 'u1', name: 'Ravi' },
    ];

    const result = await insertContacts(client, rows);

    expect(result).toEqual({ data: created, error: null });
    expect(calls).toEqual([
      {
        table: 'contacts',
        op: 'insert',
        payload: rows,
        columns: undefined,
        filters: [],
        returning: true,
        terminal: 'list',
      },
    ]);
  });

  it('returns an empty list and the error when the batch insert fails', async () => {
    const { client } = stubClient(() => failed);

    const result = await insertContacts(client, [
      { account_id: 'a1', user_id: 'u1' },
    ]);

    expect(result).toEqual({ data: [], error: failure });
  });
});

describe('tags and notes', () => {
  it('lists the tag ids and names of the account', async () => {
    const rows = [{ id: 't1', name: 'Lake View' }];
    const { client, calls } = stubClient(() => ok(rows));

    const result = await listTagIdNames(client, 'a1');

    expect(result).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      {
        table: 'tags',
        op: 'select',
        columns: 'id, name',
        filters: [['account_id', 'a1']],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('creates a tag and returns the created row', async () => {
    const created = { id: 't1', name: 'Lake View' };
    const { client, calls } = stubClient(() => ok(created));
    const row = {
      account_id: 'a1',
      user_id: 'u1',
      name: 'Lake View',
      color: '#0EA5E9',
    };

    const result = await insertTag(client, row);

    expect(result).toEqual({ data: created, error: null });
    expect(calls).toEqual([
      {
        table: 'tags',
        op: 'insert',
        payload: row,
        columns: undefined,
        filters: [],
        returning: true,
        terminal: 'single',
      },
    ]);
  });

  it('returns the tag insert error', async () => {
    const { client } = stubClient(() => failed);

    const result = await insertTag(client, {
      account_id: 'a1',
      user_id: 'u1',
      name: 'Lake View',
    });

    expect(result).toEqual({ data: null, error: failure });
  });

  it('links tags to contacts', async () => {
    const { client, calls } = stubClient(() => ok(null));
    const rows = [{ contact_id: 'c1', tag_id: 't1' }];

    const result = await insertContactTags(client, rows);

    expect(result).toEqual({ error: null });
    expect(calls).toEqual([
      {
        table: 'contact_tags',
        op: 'insert',
        payload: rows,
        filters: [],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('returns the tag link error', async () => {
    const { client } = stubClient(() => failed);

    const result = await insertContactTags(client, [
      { contact_id: 'c1', tag_id: 't1' },
    ]);

    expect(result).toEqual({ error: failure });
  });

  it('saves contact notes carrying the account id', async () => {
    const { client, calls } = stubClient(() => ok(null));
    const rows = [
      {
        contact_id: 'c1',
        user_id: 'u1',
        account_id: 'a1',
        note_text: 'Wants a farm plot',
      },
    ];

    const result = await insertContactNotes(client, rows);

    expect(result).toEqual({ error: null });
    expect(calls).toEqual([
      {
        table: 'contact_notes',
        op: 'insert',
        payload: rows,
        filters: [],
        returning: false,
        terminal: 'list',
      },
    ]);
  });

  it('returns the note insert error', async () => {
    const { client } = stubClient(() => failed);

    const result = await insertContactNotes(client, [
      {
        contact_id: 'c1',
        user_id: 'u1',
        account_id: 'a1',
        note_text: 'x',
      },
    ]);

    expect(result).toEqual({ error: failure });
  });
});

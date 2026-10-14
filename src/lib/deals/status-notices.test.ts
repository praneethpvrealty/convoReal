import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSessionOpen, sendDenNotification } from '@/lib/den/notify';
import { resolveQuietPeriod } from '@/lib/notifications/quiet-hours';
import { accountBrandName } from '@/lib/showcase/account-showcase-url';
import {
  DEAL_STATUS_NOTICE_TEMPLATE_NAMES,
  MAX_ATTEMPTS,
  SESSION_WAIT_MS,
  dealStatusNoticeParams,
  drainDealStatusNotices,
  drainDealStatusNoticesForConnectedAccounts,
  noticeDisposition,
  pickDealStatusNoticeTemplate,
} from './status-notices';

vi.mock('@/lib/den/notify', () => ({
  isSessionOpen: vi.fn(),
  sendDenNotification: vi.fn(),
}));
vi.mock('@/lib/notifications/quiet-hours', () => ({
  resolveQuietPeriod: vi.fn(),
}));
vi.mock('@/lib/showcase/account-showcase-url', () => ({
  accountBrandName: vi.fn(),
}));

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const triggers = readFileSync(
  join(
    MIGRATIONS,
    '20261014023548_sync_todos_with_deal_status_and_queue_counterpart_notices.sql'
  ),
  'utf8'
);
const sweep = readFileSync(
  join(MIGRATIONS, '20261014081351_deal_status_notice_sweep.sql'),
  'utf8'
);
const hotfix = readFileSync(
  join(MIGRATIONS, '20261014082622_deal_closed_trigger_event_type.sql'),
  'utf8'
);
const hardening = readFileSync(
  join(MIGRATIONS, '20261014081400_deal_status_notice_policies_and_brand.sql'),
  'utf8'
);

const NOW = new Date('2026-10-14T09:00:00.000Z');

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

function fakeDb(responses: Record<string, unknown[]>, rpc: unknown = 0) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const methods = [
      'select',
      'update',
      'eq',
      'or',
      'order',
      'limit',
      'maybeSingle',
    ];
    for (const method of methods) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      });
    }
    const used = new Set<string>();
    for (const method of methods) {
      const inner = chain[method] as (...args: unknown[]) => unknown;
      chain[method] = (...args: unknown[]) => {
        used.add(method);
        return inner(...args);
      };
    }
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject: (error: unknown) => unknown
    ) => {
      const bareUpdate = used.has('update') && !used.has('maybeSingle');
      const queue = responses[bareUpdate ? `${table}#update` : table] ?? [];
      const next = queue.length ? queue.shift() : { data: null, error: null };
      return Promise.resolve(next).then(resolve, reject);
    };
    return chain;
  });
  const db = {
    from,
    rpc: vi.fn(async () => ({ data: rpc, error: null })),
  } as unknown as SupabaseClient;
  return { db, calls };
}

function updatesTo(calls: Call[], table: string): Record<string, unknown>[] {
  return calls
    .filter((c) => c.table === table && c.method === 'update')
    .map((c) => c.args[0] as Record<string, unknown>);
}

const buyerRow = {
  id: 'n-1',
  account_id: 'acc-1',
  contact_id: 'c-1',
  recipient_name: 'Adithi Rao',
  recipient_role: 'buyer',
  property_id: 'p-1',
  event: 'dropped',
  message_text:
    'Update on #19 JP Nagar: this transaction will not be proceeding further.',
  attempt_count: 0,
  created_at: '2026-10-14T08:00:00.000Z',
};

const listing = {
  id: 'p-1',
  title: '#19, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
  owner_contact_id: 'owner-1',
  sublocality: 'JP Nagar',
  city: 'Bengaluru',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveQuietPeriod).mockResolvedValue({
    isQuiet: false,
    deliverAt: null,
  } as never);
  vi.mocked(accountBrandName).mockResolvedValue('Aryavarta Ventures');
});

describe('[DSN-001] the notice goes out through the approved enquiry status template', () => {
  it('prefers the listing notice, then the plain status notice, by approved utility row', () => {
    expect(DEAL_STATUS_NOTICE_TEMPLATE_NAMES).toEqual([
      'listing_status_notice',
      'property_enquiry_notice',
      'enquiry_status_notice',
      'property_enquiry_status',
    ]);
    const picked = pickDealStatusNoticeTemplate([
      { name: 'listing_status_notice', status: 'PENDING', category: 'Utility' },
      {
        name: 'enquiry_status_notice',
        status: 'APPROVED',
        category: 'Utility',
      },
      {
        name: 'property_enquiry_notice',
        status: 'APPROVED',
        category: 'Marketing',
      },
    ]);
    expect(picked?.name).toBe('enquiry_status_notice');
  });

  it('builds exactly the param count each template name was approved with', () => {
    const description = '#19 JP Nagar 4th Phase, Bengaluru';
    expect(
      dealStatusNoticeParams(
        'listing_status_notice',
        'Adithi Rao',
        description,
        'Aryavarta'
      )
    ).toEqual(['Adithi', 'Aryavarta', description]);
    expect(
      dealStatusNoticeParams(
        'property_enquiry_notice',
        'Adithi Rao',
        description,
        'Aryavarta'
      )
    ).toEqual(['Adithi', description]);
    expect(
      dealStatusNoticeParams(
        'enquiry_status_notice',
        'Adithi Rao',
        description,
        null
      )
    ).toEqual(['Adithi', 'ConvoReal']);
    expect(
      dealStatusNoticeParams(
        'property_enquiry_status',
        'Housing Lead',
        description,
        null
      )
    ).toEqual(['there']);
  });

  it('sends the queued text inside an open session and the template outside it', async () => {
    vi.mocked(isSessionOpen).mockResolvedValue(false);
    vi.mocked(sendDenNotification).mockResolvedValue(true);
    const { db, calls } = fakeDb({
      deal_status_notifications: [
        { data: [buyerRow], error: null },
        { data: { id: 'n-1' }, error: null },
      ],
      contacts: [
        { data: { id: 'c-1', name: 'Adithi Rao', phone: '+919999999999' } },
      ],
      properties: [{ data: listing }],
    });

    const summary = await drainDealStatusNotices(db, 'acc-1', { now: NOW });

    expect(summary).toMatchObject({
      queued: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    const args = vi.mocked(sendDenNotification).mock.calls[0][1];
    expect(args.text).toBe(buyerRow.message_text);
    expect(args.templateName).toEqual(DEAL_STATUS_NOTICE_TEMPLATE_NAMES);
    expect(
      args.buildParams!({ name: 'listing_status_notice' } as never)
    ).toEqual([
      'Adithi',
      'Aryavarta Ventures',
      '#19, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase, Bengaluru',
    ]);
    const final = updatesTo(calls, 'deal_status_notifications').at(-1);
    expect(final).toMatchObject({
      status: 'sent',
      claimed_at: null,
      last_error: null,
    });
  });
});

describe('[DSN-002] the template never carries news it was not written for', () => {
  it('uses free-form text whenever the session is open', () => {
    expect(
      noticeDisposition(
        {
          event: 'won',
          recipient_role: 'buyer',
          created_at: NOW.toISOString(),
        },
        true,
        NOW
      )
    ).toEqual({ kind: 'text' });
  });

  it('falls back to the template only for a buyer whose listing is gone', () => {
    for (const event of ['dropped', 'lost', 'property_sold'] as const) {
      expect(
        noticeDisposition(
          { event, recipient_role: 'buyer', created_at: NOW.toISOString() },
          false,
          NOW
        )
      ).toEqual({ kind: 'template' });
    }
  });

  it('waits for a session on a won deal or a stakeholder, then skips after 48 hours', () => {
    const fresh = {
      event: 'won' as const,
      recipient_role: 'buyer',
      created_at: NOW.toISOString(),
    };
    expect(noticeDisposition(fresh, false, NOW)).toEqual({ kind: 'wait' });
    const stale = new Date(NOW.getTime() - SESSION_WAIT_MS).toISOString();
    expect(
      noticeDisposition({ ...fresh, created_at: stale }, false, NOW)
    ).toMatchObject({ kind: 'skip' });
    expect(
      noticeDisposition(
        {
          event: 'lost',
          recipient_role: 'advocate',
          created_at: NOW.toISOString(),
        },
        false,
        NOW
      )
    ).toEqual({ kind: 'wait' });
    expect(
      noticeDisposition(
        { event: 'lost', recipient_role: 'advocate', created_at: stale },
        false,
        NOW
      )
    ).toMatchObject({ kind: 'skip' });
  });
});

describe('[DSN-003] who is never messaged, and when a row waits', () => {
  it('skips the property owner and a recipient without a contact record', async () => {
    vi.mocked(isSessionOpen).mockResolvedValue(true);
    const { db, calls } = fakeDb({
      deal_status_notifications: [
        {
          data: [
            { ...buyerRow, id: 'n-owner', contact_id: 'owner-1' },
            {
              ...buyerRow,
              id: 'n-phone',
              contact_id: null,
              recipient_role: 'banker',
            },
          ],
          error: null,
        },
        { data: { id: 'n-owner' }, error: null },
        { data: { id: 'n-phone' }, error: null },
      ],
      contacts: [
        { data: { id: 'owner-1', name: 'Owner', phone: '+911111111111' } },
      ],
      properties: [{ data: listing }],
    });

    const summary = await drainDealStatusNotices(db, 'acc-1', { now: NOW });

    expect(summary).toMatchObject({ queued: 2, sent: 0, skipped: 2 });
    expect(sendDenNotification).not.toHaveBeenCalled();
    const updates = updatesTo(calls, 'deal_status_notifications').filter(
      (u) => u.status === 'skipped'
    );
    expect(updates.map((u) => u.last_error)).toEqual([
      'Recipient owns the property',
      'No contact record for recipient',
    ]);
  });

  it('holds a row through client quiet hours without spending an attempt', async () => {
    vi.mocked(resolveQuietPeriod).mockResolvedValue({
      isQuiet: true,
      deliverAt: new Date('2026-10-15T03:30:00.000Z'),
    } as never);
    const { db, calls } = fakeDb({
      deal_status_notifications: [
        { data: [buyerRow], error: null },
        { data: { id: 'n-1' }, error: null },
      ],
      contacts: [
        { data: { id: 'c-1', name: 'Adithi Rao', phone: '+919999999999' } },
      ],
      properties: [{ data: listing }],
    });

    const summary = await drainDealStatusNotices(db, 'acc-1', { now: NOW });

    expect(summary).toMatchObject({ deferred: 1, sent: 0, failed: 0 });
    expect(sendDenNotification).not.toHaveBeenCalled();
    expect(updatesTo(calls, 'deal_status_notifications').at(-1)).toEqual({
      claimed_at: null,
    });
  });

  it('retries a failed send hourly and gives up after the third attempt', async () => {
    vi.mocked(isSessionOpen).mockResolvedValue(false);
    vi.mocked(sendDenNotification).mockResolvedValue(false);
    const { db, calls } = fakeDb({
      deal_status_notifications: [
        {
          data: [
            { ...buyerRow, id: 'n-first' },
            { ...buyerRow, id: 'n-last', attempt_count: MAX_ATTEMPTS - 1 },
          ],
          error: null,
        },
        { data: { id: 'n-first' }, error: null },
        { data: { id: 'n-last' }, error: null },
      ],
      contacts: [
        { data: { id: 'c-1', name: 'Adithi Rao', phone: '+919999999999' } },
        { data: { id: 'c-1', name: 'Adithi Rao', phone: '+919999999999' } },
      ],
      properties: [{ data: listing }, { data: listing }],
    });

    const summary = await drainDealStatusNotices(db, 'acc-1', { now: NOW });

    expect(summary).toMatchObject({ failed: 2, sent: 0 });
    const fetches = calls.filter(
      (c) => c.table === 'deal_status_notifications' && c.method === 'or'
    );
    expect(fetches[0].args[0]).toBe(
      'claimed_at.is.null,claimed_at.lt.2026-10-14T08:00:00.000Z'
    );
    const outcomes = updatesTo(calls, 'deal_status_notifications').filter(
      (u) => 'attempt_count' in u
    );
    expect(outcomes).toEqual([
      {
        status: 'pending',
        attempt_count: 1,
        last_error: 'WhatsApp channel unavailable',
      },
      {
        status: 'failed',
        attempt_count: MAX_ATTEMPTS,
        last_error: 'WhatsApp channel unavailable',
      },
    ]);
  });

  it('retries the sent update once and reports a notice that stays pending', async () => {
    vi.mocked(isSessionOpen).mockResolvedValue(true);
    vi.mocked(sendDenNotification).mockResolvedValue(true);
    const { db, calls } = fakeDb({
      deal_status_notifications: [
        { data: [buyerRow], error: null },
        { data: { id: 'n-1' }, error: null },
      ],
      'deal_status_notifications#update': [
        { data: null, error: { message: 'connection reset' } },
        { data: null, error: { message: 'connection reset' } },
      ],
      contacts: [
        { data: { id: 'c-1', name: 'Adithi Rao', phone: '+919999999999' } },
      ],
      properties: [{ data: listing }],
    });

    const summary = await drainDealStatusNotices(db, 'acc-1', { now: NOW });

    expect(sendDenNotification).toHaveBeenCalledTimes(1);
    expect(
      updatesTo(calls, 'deal_status_notifications').filter(
        (u) => u.status === 'sent'
      )
    ).toHaveLength(2);
    expect(summary).toMatchObject({ sent: 0, failed: 1 });
  });

  it('sweeps stale todos on every account, then drains only connected senders', async () => {
    const { db } = fakeDb(
      {
        accounts: [{ data: [{ id: 'acc-1' }, { id: 'acc-2' }], error: null }],
        whatsapp_config: [{ data: [{ account_id: 'acc-1' }], error: null }],
        deal_status_notifications: [{ data: [], error: null }],
      },
      2
    );
    const summary = await drainDealStatusNoticesForConnectedAccounts(db, NOW);
    expect(vi.mocked(db.rpc).mock.calls.map((c) => c[1])).toEqual([
      { p_account_id: 'acc-1' },
      { p_account_id: 'acc-2' },
    ]);
    expect(summary).toMatchObject({ closedTodos: 4, queued: 0 });
  });
});

describe('[DSN-004] the database closes the tasks and queues the notices', () => {
  it('watches a journey drop, a won or lost deal, and a property leaving the market', () => {
    expect(triggers).toMatch(
      /create trigger journey_item_dropped_sync_trigger\s+after update of status on public\.journey_items[\s\S]*?new\.status = 'dropped'/
    );
    expect(triggers).toMatch(
      /create trigger deal_closed_sync_trigger\s+after update of status on public\.deals[\s\S]*?new\.status in \('won','lost'\)/
    );
    expect(triggers).toMatch(
      /create trigger property_withdrawn_sync_trigger\s+after update of status on public\.properties[\s\S]*?new\.status in \('Sold','Off Market','Archived'\)/
    );
    expect(triggers).toContain('set completed = true');
    expect(triggers).toMatch(
      /if new\.status = 'Sold' then[\s\S]*?'property_sold'/
    );
  });

  it('records the auto-close on the deal timeline as a system note the event-type check allows', () => {
    expect(hotfix).toMatch(
      /INSERT INTO deal_events[\s\S]*?'note_added', 'system'[\s\S]*?'kind', 'tasks_auto_closed'[\s\S]*?'note', 'Follow-up tasks auto-closed; counterpart notices queued'/
    );
    expect(hotfix).not.toMatch(/'tasks_auto_closed', 'system'/);
    const allowed = readFileSync(
      join(
        MIGRATIONS,
        '20260918050100_transaction_workspace_update_events.sql'
      ),
      'utf8'
    );
    expect(allowed).toContain("'note_added'");
    expect(allowed).not.toContain("'tasks_auto_closed'");
  });

  it('never queues the property owner and keeps the internal reason off the message', () => {
    expect(triggers).toMatch(
      /if p_contact_id is not null and v_owner is not null and p_contact_id = v_owner then return; end if;/
    );
    expect(triggers).toMatch(/s\.side = 'buyer'/);
    const queueBody =
      /function public\.queue_deal_status_notice[\s\S]*?end \$\$;/.exec(
        triggers
      )![0];
    expect(queueBody).not.toMatch(
      /v_msg := [\s\S]*p_reason[\s\S]*end;\n\n  insert/
    );
    expect(hardening).not.toMatch(/'\|\| p_reason|p_reason \|\|/);
  });

  it('collapses a drop and the lost deal it becomes into one notice, and signs won with the account name', () => {
    expect(sweep).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS deal_status_notifications_pending_outcome_dedupe[\s\S]*?COALESCE\(contact_id::text, recipient_phone\)[\s\S]*?CASE WHEN event IN \('dropped', 'lost'\) THEN 'closed' ELSE event END[\s\S]*?WHERE status = 'pending'/
    );
    expect(hardening).toContain(
      "SELECT NULLIF(TRIM(name), '') INTO v_brand FROM accounts WHERE id = p_account_id;"
    );
    expect(hardening).not.toContain('Aryavarta');
  });

  it('keeps the definer functions off PostgREST and the policies on the account helpers', () => {
    for (const fn of [
      'auto_close_todos(UUID, UUID, UUID, TEXT)',
      'queue_deal_status_notice(UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT)',
      'auto_close_stale_deal_todos(UUID)',
    ]) {
      expect(sweep).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`
      );
    }
    expect(hardening).toMatch(
      /ALTER POLICY "account members read own notices" ON public\.deal_status_notifications\s+USING \(is_account_member\(account_id\)\);/
    );
    expect(hardening).toMatch(
      /ALTER POLICY "account members update own notices" ON public\.deal_status_notifications\s+USING \(is_account_writer\(account_id, 'agent'\)\)/
    );
    expect(sweep + hardening).not.toMatch(/\bDROP\b/);
  });

  it('sweeps only todos whose property, deal or sole journey branch is closed', () => {
    expect(sweep).toMatch(/p\.status IN \('Sold', 'Off Market', 'Archived'\)/);
    expect(sweep).toMatch(/d\.status IN \('won', 'lost'\)/);
    expect(sweep).toMatch(
      /ji\.status = 'dropped'[\s\S]*?AND NOT EXISTS \([\s\S]*?ji\.status <> 'dropped'/
    );
    expect(sweep).toMatch(
      /WHERE t\.account_id = p_account_id\s+AND NOT t\.completed/
    );
  });
});

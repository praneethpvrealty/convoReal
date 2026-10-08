import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  notify: vi.fn(),
  conversation: null as { id: string } | null,
}));

vi.mock('@/lib/notifications/create', () => ({
  createNotification: (...args: unknown[]) => h.notify(...args),
}));
vi.mock('@/lib/conversations/resolve', () => ({
  lookupConversation: async () => ({
    conversation: h.conversation,
    error: null,
  }),
}));

import {
  buildHotViewerAlert,
  formatDwell,
  processHotViewerAlerts,
} from './hot-viewers';

const ACCOUNT = 'acc-1';
const CONTACT = 'contact-1';
const PROPERTY = '11111111-2222-4333-8444-555555555555';

function fakeDb(state: {
  candidates: Row[];
  claimId?: string | null;
  tables: Record<string, Row[]>;
}) {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const updates: Array<{ table: string; payload: unknown }> = [];
  const db = {
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      if (fn === 'showcase_hot_viewer_candidates') {
        return { data: state.candidates, error: null };
      }
      return {
        data: state.claimId === undefined ? 'alert-1' : state.claimId,
        error: null,
      };
    },
    from: (table: string) => {
      const filters: Row = {};
      const api = {
        select: () => api,
        update: (payload: unknown) => {
          updates.push({ table, payload });
          return api;
        },
        delete: () => {
          updates.push({ table, payload: 'delete' });
          return api;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return api;
        },
        maybeSingle: async () => ({
          data:
            (state.tables[table] ?? []).find((row) =>
              Object.entries(filters).every(([k, v]) => row[k] === v)
            ) ?? null,
          error: null,
        }),
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onFulfilled),
      };
      return api;
    },
  };
  return { db: db as never, rpcCalls, updates };
}

const candidate = {
  account_id: ACCOUNT,
  contact_id: CONTACT,
  property_id: PROPERTY,
  dwell_ms: 252_000,
  view_days: 3,
  viewed_at: new Date().toISOString(),
};

function tables(assignedAgent: string | null = 'agent-user') {
  return {
    contacts: [
      {
        id: CONTACT,
        account_id: ACCOUNT,
        name: 'Ravi Teja',
        phone: '919000000001',
        assigned_agent_id: assignedAgent,
      },
    ],
    properties: [
      {
        id: PROPERTY,
        account_id: ACCOUNT,
        title: '3 BHK in Kondapur',
        user_id: 'lister-user',
        status: 'Available',
      },
    ],
    whatsapp_config: [{ account_id: ACCOUNT, user_id: 'owner-user' }],
  };
}

beforeEach(() => {
  h.notify.mockReset().mockResolvedValue({});
  h.conversation = null;
});

describe('[PLS-008] hot viewer alerts', () => {
  it('formats dwell the way an agent reads it', () => {
    expect(formatDwell(42_000)).toBe('42s');
    expect(formatDwell(120_000)).toBe('2m');
    expect(formatDwell(252_000)).toBe('4m 12s');
  });

  it('names the contact, the listing and both signals', () => {
    const alert = buildHotViewerAlert({
      contactName: 'Ravi Teja',
      contactPhone: '919000000001',
      propertyTitle: '3 BHK in Kondapur',
      dwellMs: 252_000,
      viewDays: 3,
    });
    expect(alert.title).toBe('🔥 Hot viewer: Ravi Teja');
    expect(alert.body).toContain('Ravi Teja (919000000001)');
    expect(alert.body).toContain('3 BHK in Kondapur');
    expect(alert.body).toContain('spent 4m 12s on it');
    expect(alert.body).toContain('came back on 3 different days');
    expect(
      buildHotViewerAlert({
        contactName: 'Ravi',
        contactPhone: null,
        propertyTitle: 'x',
        dwellMs: 130_000,
        viewDays: 1,
      }).body
    ).not.toContain('came back');
  });

  it('asks the SQL gate for 2+ minutes or 2+ days, fresh in the last day, re-alerting weekly', async () => {
    const { db, rpcCalls } = fakeDb({ candidates: [], tables: tables() });
    await processHotViewerAlerts(db);
    expect(rpcCalls[0]).toEqual({
      fn: 'showcase_hot_viewer_candidates',
      args: {
        p_min_dwell_ms: 120_000,
        p_min_days: 2,
        p_settle_minutes: 10,
        p_fresh_hours: 24,
        p_lookback_days: 7,
        p_realert_days: 7,
        p_limit: 50,
      },
    });
  });

  it('alerts the assigned agent on the conversation, respecting agent quiet hours', async () => {
    h.conversation = { id: 'conv-1' };
    const { db, updates } = fakeDb({
      candidates: [candidate],
      tables: tables(),
    });
    expect(await processHotViewerAlerts(db)).toBe(1);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        userId: 'agent-user',
        eventKey: 'showcase_hot_viewer',
        entityType: 'conversation',
        entityId: 'conv-1',
        link: '/inbox?conversation=conv-1',
        quietAudience: 'agent',
      })
    );
    expect(updates).toEqual([
      {
        table: 'showcase_hot_viewer_alerts',
        payload: { agent_user_id: 'agent-user' },
      },
    ]);
  });

  it('falls back to the listing manager and links the contact when there is no chat', async () => {
    const { db } = fakeDb({ candidates: [candidate], tables: tables(null) });
    await processHotViewerAlerts(db);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'lister-user',
        entityType: 'contact',
        entityId: CONTACT,
        link: `/contacts?contactId=${CONTACT}`,
      })
    );
  });

  it('releases the claim and alerts nobody when the listing stopped being Available', async () => {
    const t = tables();
    t.properties[0] = { ...t.properties[0], status: 'Sold' };
    const { db, updates } = fakeDb({ candidates: [candidate], tables: t });
    expect(await processHotViewerAlerts(db)).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { table: 'showcase_hot_viewer_alerts', payload: 'delete' },
    ]);
  });

  it('alerts nobody when the claim is lost', async () => {
    const { db } = fakeDb({
      candidates: [candidate],
      claimId: null,
      tables: tables(),
    });
    expect(await processHotViewerAlerts(db)).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });
});

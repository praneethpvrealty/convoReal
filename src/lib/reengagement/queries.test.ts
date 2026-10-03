import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LEADS_PAGE_SIZE, LEAD_SORTS, loadReengagementLeads } from './queries';

function row(over: Record<string, unknown> = {}) {
  return {
    contact_id: 'c1',
    contact_name: 'Asha',
    contact_phone: '+919876543210',
    broadcast_id: 'b1',
    broadcast_name: 'Batch',
    batch_sent_at: '2026-08-07T05:00:00Z',
    status: 'replied',
    replied_at: '2026-08-10T00:00:00Z',
    requirement_updated_at: null,
    budget_min: '5000000',
    budget_max: null,
    areas: null,
    match_event_id: 'e1',
    match_count: 3,
    match_event_status: null,
    total_count: 240,
    ...over,
  };
}

function fakeDb(rows: unknown[] = [], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe('loadReengagementLeads', () => {
  it('asks for the standing batch order unless told otherwise', async () => {
    const { db, rpc } = fakeDb();
    await loadReengagementLeads(db, 'acct-1');
    expect(rpc).toHaveBeenCalledWith('reengagement_leads', {
      p_account_id: 'acct-1',
      p_broadcast_id: null,
      p_only_matched: false,
      p_limit: LEADS_PAGE_SIZE,
      p_offset: 0,
      p_sort: 'batch',
    });
  });

  it.each(LEAD_SORTS)('passes %s to the function as p_sort', async (sort) => {
    const { db, rpc } = fakeDb();
    await loadReengagementLeads(db, 'acct-1', { sort });
    expect(rpc.mock.calls[0][1].p_sort).toBe(sort);
  });

  it('sends the sort with the page offset so the database orders before it pages', async () => {
    const { db, rpc } = fakeDb();
    await loadReengagementLeads(db, 'acct-1', {
      broadcastId: 'b1',
      onlyMatched: true,
      sort: 'replied_desc',
      page: 2,
    });
    expect(rpc).toHaveBeenCalledWith('reengagement_leads', {
      p_account_id: 'acct-1',
      p_broadcast_id: 'b1',
      p_only_matched: true,
      p_limit: LEADS_PAGE_SIZE,
      p_offset: 2 * LEADS_PAGE_SIZE,
      p_sort: 'replied_desc',
    });
  });

  it('keeps the rows in the order the function returned them', async () => {
    const { db } = fakeDb([
      row({ contact_id: 'low', match_count: 1 }),
      row({ contact_id: 'high', match_count: 9 }),
    ]);
    const { leads, total } = await loadReengagementLeads(db, 'acct-1', {
      sort: 'matches_asc',
    });
    expect(leads.map((l) => l.contactId)).toEqual(['low', 'high']);
    expect(total).toBe(240);
    expect(leads[0].budgetMin).toBe(5000000);
    expect(leads[0].areas).toEqual([]);
  });

  it('throws what the function reported', async () => {
    const { db } = fakeDb(null as unknown as unknown[], {
      message: 'permission denied',
    });
    await expect(loadReengagementLeads(db, 'acct-1')).rejects.toEqual({
      message: 'permission denied',
    });
  });
});

describe('LEAD_SORTS vs reengagement_leads()', () => {
  const sql = readFileSync(
    'supabase/migrations/20261003124115_reengagement_leads_sort.sql',
    'utf8'
  );
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
  const orderBy = body.slice(
    body.indexOf('ORDER BY CASE'),
    body.indexOf('LIMIT GREATEST')
  );

  it('defaults p_sort to the batch order', () => {
    expect(body).toMatch(/p_sort TEXT DEFAULT 'batch'/);
  });

  it('orders by every sort the client can ask for, and no other', () => {
    const inSql = [...orderBy.matchAll(/p_sort = '([a-z_]+)'/g)].map(
      (m) => m[1]
    );
    expect([...inSql].sort()).toEqual(
      LEAD_SORTS.filter((s) => s !== 'batch').sort()
    );
  });

  it('puts a lead that never replied last in both reply directions', () => {
    expect(orderBy).toMatch(
      /p_sort = 'replied_desc' THEN f\.replied_at\s+END DESC NULLS LAST/
    );
    expect(orderBy).toMatch(
      /p_sort = 'replied_asc'\s+THEN f\.replied_at\s+END ASC\s+NULLS LAST/
    );
  });

  it('sorts before it paginates and closes the order on the recipient id', () => {
    expect(orderBy.trimEnd().endsWith('f.recipient_id')).toBe(true);
    expect(body.indexOf('ORDER BY CASE')).toBeLessThan(
      body.indexOf('LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)')
    );
  });

  it('keeps the membership guard and the pre-pagination total', () => {
    expect(body).toContain('WHERE is_account_member(p_account_id)');
    expect(body).toContain('(SELECT count(*) FROM filtered)');
    expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });

  it('drops the five-argument function instead of leaving an overload', () => {
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT);'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.reengagement_leads(UUID, UUID, BOOLEAN, INT, INT, TEXT) FROM anon;'
    );
  });
});

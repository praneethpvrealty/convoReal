// ============================================================
// /api/admin/copilot-demand — the helper's feature-request backlog.
//
//   GET — every unmet capability users asked the copilot for,
//         grouped by capability_key and ranked by breadth (distinct
//         accounts) then depth (total asks).
//
// Super-admin only, service-role client. copilot_unmet_requests RLS
// scopes tenants to their own rows; the cross-tenant ranking is the
// whole point of this screen, so the super_admin check IS the
// boundary here. Grouping happens in the route, not the browser:
// the table grows with distinct (account, capability) pairs — repeat
// asks bump a counter — so the read is bounded, and the client only
// ever receives the aggregated groups.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const MAX_ROWS = 2000;

async function requireSuperAdmin(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, body: { error: 'Unauthorized' } };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profile?.role !== 'super_admin') {
    return { ok: false as const, status: 403, body: { error: 'Forbidden' } };
  }
  return { ok: true as const };
}

interface DemandRow {
  capability: string;
  capability_key: string;
  sample_question: string;
  pathname: string | null;
  request_count: number;
  last_requested_at: string;
  account_id: string;
  accounts: { name: string } | { name: string }[] | null;
}

export interface DemandAccount {
  accountId: string;
  accountName: string;
  asks: number;
  sampleQuestion: string;
  pathname: string | null;
  lastAskedAt: string;
}

export interface DemandCapability {
  key: string;
  capability: string;
  accounts: number;
  asks: number;
  lastAskedAt: string;
  requesters: DemandAccount[];
}

function accountName(row: DemandRow): string {
  const a = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  return a?.name ?? 'Unknown account';
}

export async function GET() {
  const supabase = await createClient();
  const guard = await requireSuperAdmin(supabase);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data, error } = await supabaseAdmin()
    .from('copilot_unmet_requests')
    .select(
      'capability, capability_key, sample_question, pathname, request_count, last_requested_at, account_id, accounts(name)'
    )
    .order('last_requested_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error('[GET /api/admin/copilot-demand] fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to load demand log' },
      { status: 500 }
    );
  }

  const groups = new Map<string, DemandCapability>();
  for (const row of (data ?? []) as DemandRow[]) {
    let group = groups.get(row.capability_key);
    if (!group) {
      group = {
        key: row.capability_key,
        capability: row.capability,
        accounts: 0,
        asks: 0,
        lastAskedAt: row.last_requested_at,
        requesters: [],
      };
      groups.set(row.capability_key, group);
    }
    group.accounts += 1;
    group.asks += row.request_count;
    if (row.last_requested_at > group.lastAskedAt) {
      group.lastAskedAt = row.last_requested_at;
    }
    group.requesters.push({
      accountId: row.account_id,
      accountName: accountName(row),
      asks: row.request_count,
      sampleQuestion: row.sample_question,
      pathname: row.pathname,
      lastAskedAt: row.last_requested_at,
    });
  }

  const capabilities = [...groups.values()].sort(
    (a, b) => b.accounts - a.accounts || b.asks - a.asks
  );
  for (const c of capabilities) {
    c.requesters.sort((a, b) => b.asks - a.asks);
  }

  return NextResponse.json({
    capabilities,
    truncated: (data ?? []).length === MAX_ROWS,
  });
}

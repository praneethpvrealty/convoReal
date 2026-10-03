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
import { toErrorResponse } from '@/lib/auth/account';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';

import { supabaseAdmin } from '@/lib/supabase/admin';

const MAX_ROWS = 2000;

type DemandAudience = 'agent' | 'owner' | 'buyer';

interface DemandRow {
  audience: DemandAudience | null;
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
  audience: DemandAudience;
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
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { data, error } = await supabaseAdmin()
    .from('copilot_unmet_requests')
    .select(
      'audience, capability, capability_key, sample_question, pathname, request_count, last_requested_at, account_id, accounts(name)'
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

  // Grouped by (audience, capability): an owner asking for something
  // is a different product signal from an agent asking for the same
  // words, so the two must never merge into one backlog row.
  const groups = new Map<string, DemandCapability>();
  for (const row of (data ?? []) as DemandRow[]) {
    const audience = row.audience ?? 'agent';
    const key = `${audience}:${row.capability_key}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        audience,
        capability: row.capability,
        accounts: 0,
        asks: 0,
        lastAskedAt: row.last_requested_at,
        requesters: [],
      };
      groups.set(key, group);
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

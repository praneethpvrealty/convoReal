import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { milestoneProgress, type DealMilestone } from '@/lib/deals/milestones';

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/deal-groups/[id] — the bundle and its member deals with
// combined milestone progress. Internal view only; an external
// projection of a bundle goes through src/lib/deals/visibility.ts.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    const { data: group } = await ctx.supabase
      .from('deal_groups')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!group) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
    }

    const { data: deals, error } = await ctx.supabase
      .from('deals')
      .select(
        'id, title, status, value, currency, ' +
          'stage:pipeline_stages(name, color), ' +
          'contact:contacts(id, name, second_name), ' +
          'property:properties(id, title, unit_no), ' +
          'milestones:deal_milestones(status, position, title, target_date)'
      )
      .eq('account_id', ctx.accountId)
      .eq('deal_group_id', id)
      .order('created_at');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    type MemberRow = Record<string, unknown> & {
      milestones?: Pick<DealMilestone, 'status' | 'position' | 'title' | 'target_date'>[] | null;
    };
    const members = ((deals ?? []) as unknown as MemberRow[]).map((deal) => {
      const { milestones, ...rest } = deal;
      return { ...rest, progress: milestoneProgress(milestones ?? []) };
    });
    const combined = members.reduce(
      (acc, m) => ({
        total: acc.total + m.progress.total,
        done: acc.done + m.progress.done,
      }),
      { total: 0, done: 0 }
    );

    return NextResponse.json({ data: { ...group, deals: members, progress: combined } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

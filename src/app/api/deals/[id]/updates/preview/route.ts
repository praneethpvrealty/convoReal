import { NextResponse } from 'next/server';

import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import { loadDealHead } from '@/lib/deals/server';
import type { DealStakeholder } from '@/lib/deals/stakeholders';
import {
  loadUpdateSources,
  planRecipientDelivery,
} from '@/lib/deals/update-delivery';
import {
  buildUpdateSnapshot,
  isEligibleRecipient,
  parseUpdateInput,
  renderUpdateNotice,
} from '@/lib/deals/updates';

type RouteParams = { params: Promise<{ id: string }> };

// POST /api/deals/[id]/updates/preview — the same body as publish,
// answered with what each recipient would receive and how, and
// nothing written. The snapshot rules run here too, so an item the
// audience may not see is refused before anything is sent.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const parsed = parseUpdateInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    const sources = await loadUpdateSources(
      ctx.supabase,
      ctx.accountId,
      dealId
    );
    const snapshot = buildUpdateSnapshot({
      visibility: input.visibility,
      sources,
      milestoneIds: input.milestoneIds,
      eventIds: input.eventIds,
    });
    if (!snapshot.ok) {
      return NextResponse.json({ error: snapshot.error }, { status: 400 });
    }

    const ids = input.recipients.map((r) => r.stakeholderId);
    const { data: rows } = ids.length
      ? await ctx.supabase
          .from('deal_stakeholders')
          .select('*')
          .eq('deal_id', dealId)
          .eq('account_id', ctx.accountId)
          .in('id', ids)
      : { data: [] };
    const stakeholders = (rows ?? []) as DealStakeholder[];

    const { data: account } = await ctx.supabase
      .from('accounts')
      .select('name')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const brandName =
      (account as { name?: string | null } | null)?.name || 'your agent';

    const recipients = [];
    for (const r of input.recipients) {
      const stakeholder = stakeholders.find((s) => s.id === r.stakeholderId);
      if (!stakeholder) continue;
      const eligible = isEligibleRecipient(stakeholder, input.visibility);
      const plan = eligible
        ? await planRecipientDelivery(
            ctx.supabase,
            ctx.accountId,
            stakeholder,
            r.channel
          )
        : null;
      recipients.push({
        stakeholder_id: stakeholder.id,
        name: stakeholder.name,
        side: stakeholder.side,
        channel: r.channel,
        eligible,
        mode: plan?.mode ?? null,
        reason: eligible
          ? (plan?.reason ?? null)
          : 'Not on the side this update goes to',
        needs_email: input.otpRequired && !stakeholder.email,
        text: renderUpdateNotice({
          recipientName: stakeholder.name,
          brandName,
          dealTitle: deal.title,
          headline: input.headline,
          body: input.body,
          snapshot: snapshot.value,
          url: plan?.mode === 'template' ? null : '<their private link>',
          correction: Boolean(input.supersedesUpdateId),
        }),
      });
    }

    return NextResponse.json({
      data: { snapshot: snapshot.value, recipients },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

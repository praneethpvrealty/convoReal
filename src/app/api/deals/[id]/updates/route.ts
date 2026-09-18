import { NextResponse } from 'next/server';

import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { writeDealEvent } from '@/lib/deals/events';
import { actorName, loadDealHead } from '@/lib/deals/server';
import {
  dealShareUrl,
  mintDealShareToken,
  ttlMsForKey,
} from '@/lib/deals/share-links';
import type { DealStakeholder } from '@/lib/deals/stakeholders';
import {
  loadUpdateSources,
  planRecipientDelivery,
  publicSiteUrl,
  sendEngineNotice,
  type RecipientPlan,
} from '@/lib/deals/update-delivery';
import {
  buildUpdateSnapshot,
  isEligibleRecipient,
  parseUpdateInput,
  personalWhatsAppUrl,
  renderUpdateNotice,
  updateNoticeUrl,
} from '@/lib/deals/updates';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ id: string }> };

const RECIPIENT_SELECT =
  '*, stakeholder:deal_stakeholders(id, name, role, side, phone)';

// GET /api/deals/[id]/updates — every published update with its
// recipients, newest first. The snapshot is what was said; the
// recipient rows are what happened to it.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole('viewer');
    const { id: dealId } = await params;

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('deal_updates')
      .select(`*, recipients:deal_update_recipients(${RECIPIENT_SELECT})`)
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/deals/[id]/updates — publish. Freezes the snapshot, writes
// the timeline entry at the update's own visibility, then delivers to
// each recipient and records the outcome per row. Plaintext links come
// back exactly once, in this response.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: dealId } = await params;

    const limit = await checkRateLimit(
      `agent:dealUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const deal = await loadDealHead(ctx, dealId);
    if (!deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const parsed = parseUpdateInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    if (input.supersedesUpdateId) {
      const { data: previous } = await ctx.supabase
        .from('deal_updates')
        .select('id')
        .eq('id', input.supersedesUpdateId)
        .eq('deal_id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!previous) {
        return NextResponse.json(
          { error: 'The update being corrected is not on this deal' },
          { status: 404 }
        );
      }
    }

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

    const stakeholderIds = input.recipients.map((r) => r.stakeholderId);
    const { data: stakeholderRows } = stakeholderIds.length
      ? await ctx.supabase
          .from('deal_stakeholders')
          .select('*')
          .eq('deal_id', dealId)
          .eq('account_id', ctx.accountId)
          .in('id', stakeholderIds)
      : { data: [] };
    const stakeholders = (stakeholderRows ?? []) as DealStakeholder[];
    for (const r of input.recipients) {
      const s = stakeholders.find((x) => x.id === r.stakeholderId);
      if (!s) {
        return NextResponse.json(
          { error: 'A recipient is not a stakeholder on this deal' },
          { status: 404 }
        );
      }
      if (!isEligibleRecipient(s, input.visibility)) {
        return NextResponse.json(
          { error: `${s.name} is not on the side this update goes to` },
          { status: 400 }
        );
      }
      if (input.otpRequired && !s.email) {
        return NextResponse.json(
          {
            error: `A one-time code needs somewhere to go. Add an email address for ${s.name} first.`,
          },
          { status: 409 }
        );
      }
    }

    const publisher = await actorName(ctx.supabase, ctx.accountId, ctx.userId);
    const { data: update, error: updateError } = await ctx.supabase
      .from('deal_updates')
      .insert({
        account_id: ctx.accountId,
        deal_id: dealId,
        headline: input.headline,
        body: input.body,
        visibility: input.visibility,
        snapshot: snapshot.value,
        supersedes_update_id: input.supersedesUpdateId,
        source: input.source,
        published_by: ctx.userId,
        published_by_name: publisher,
      })
      .select('*')
      .single();
    if (updateError || !update) {
      return NextResponse.json(
        { error: updateError?.message ?? 'Could not publish' },
        { status: 400 }
      );
    }

    const eventOutcome = await writeDealEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      dealId,
      eventType: 'update_published',
      title: input.supersedesUpdateId
        ? `Correction: ${input.headline}`
        : input.headline,
      actorId: ctx.userId,
      actorName: publisher,
      source: input.source,
      metadata: {
        update_id: update.id,
        supersedes_update_id: input.supersedesUpdateId,
        recipient_count: input.recipients.length,
      },
      visibility: input.visibility,
    });
    if (!eventOutcome.ok) {
      console.warn('[deal-updates] event not written:', eventOutcome.error);
    }

    const { data: account } = await ctx.supabase
      .from('accounts')
      .select('name')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const brandName =
      (account as { name?: string | null } | null)?.name || 'your agent';
    const siteUrl = publicSiteUrl(request);
    const ttlMs = ttlMsForKey(input.ttl);

    const delivered: Array<Record<string, unknown>> = [];
    for (const r of input.recipients) {
      const stakeholder = stakeholders.find((x) => x.id === r.stakeholderId)!;
      const plan: RecipientPlan = await planRecipientDelivery(
        ctx.supabase,
        ctx.accountId,
        stakeholder,
        r.channel
      );

      let linkId: string | null = null;
      let url: string | null = null;
      if (
        plan.mode === 'free_form' ||
        plan.mode === 'handoff' ||
        plan.mode === 'portal'
      ) {
        const minted = mintDealShareToken(ttlMs);
        const { data: link, error: linkError } = await ctx.supabase
          .from('deal_share_links')
          .insert({
            account_id: ctx.accountId,
            deal_id: dealId,
            stakeholder_id: stakeholder.id,
            token_hash: minted.hash,
            token_prefix: minted.prefix,
            expires_at: minted.expiresAt,
            otp_required: input.otpRequired,
            created_by: ctx.userId,
          })
          .select('id')
          .single();
        if (linkError || !link) {
          return NextResponse.json(
            { error: linkError?.message ?? 'Could not create a link' },
            { status: 400 }
          );
        }
        linkId = link.id;
        url = updateNoticeUrl(dealShareUrl(minted.token, siteUrl), update.id);
      }

      const text = renderUpdateNotice({
        recipientName: stakeholder.name,
        brandName,
        dealTitle: deal.title,
        headline: input.headline,
        body: input.body,
        snapshot: snapshot.value,
        url,
        correction: Boolean(input.supersedesUpdateId),
      });

      const row: Record<string, unknown> = {
        account_id: ctx.accountId,
        update_id: update.id,
        deal_id: dealId,
        stakeholder_id: stakeholder.id,
        link_id: linkId,
        contact_id: plan.contactId,
        channel: r.channel,
        delivery_mode: plan.mode,
        status: 'pending',
        failed_reason: null,
        link_ttl_ms: ttlMs,
        link_otp_required: input.otpRequired,
      };
      const extra: Record<string, unknown> = {};

      if (r.channel === 'engine_whatsapp') {
        if (!plan.mode) {
          row.status = 'failed';
          row.failed_reason = plan.reason;
        } else {
          const sent = await sendEngineNotice({
            accountId: ctx.accountId,
            userId: ctx.userId,
            plan,
            text,
            headline: input.headline,
            brandName,
            propertyLabel: snapshot.value.property_label,
            dealTitle: deal.title,
          });
          row.status = sent.success ? 'sent' : 'failed';
          row.sent_at = sent.success ? new Date().toISOString() : null;
          row.message_id = sent.messageId;
          row.failed_reason = sent.error;
        }
      } else if (r.channel === 'personal_whatsapp') {
        if (!plan.mode) {
          row.status = 'failed';
          row.failed_reason = plan.reason;
        } else {
          extra.url = url;
          extra.notice = text;
          extra.handoff_url = personalWhatsAppUrl(stakeholder.phone!, text);
        }
      } else {
        extra.url = url;
        extra.notice = text;
      }

      const { data: inserted, error: recipientError } = await ctx.supabase
        .from('deal_update_recipients')
        .insert(row)
        .select(RECIPIENT_SELECT)
        .single();
      if (recipientError || !inserted) {
        console.error(
          '[deal-updates] recipient row failed:',
          recipientError?.message
        );
        continue;
      }
      delivered.push({ ...inserted, ...extra });
    }

    return NextResponse.json(
      { data: { update, recipients: delivered } },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

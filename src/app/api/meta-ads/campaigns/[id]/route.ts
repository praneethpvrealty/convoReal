import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { setObjectStatus, setAdSetDailyBudget, isTokenError } from '@/lib/meta-ads/client';
import { inrToPaise, validateDailyBudgetInr } from '@/lib/meta-ads/campaign-build';

// PATCH /api/meta-ads/campaigns/[id]
// Pause, resume, archive, or re-budget one of the account's campaigns.
// The row must belong to the caller's account — the id in the URL is
// never trusted to scope by itself.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      action?: 'pause' | 'resume' | 'archive' | 'set_budget';
      daily_budget_inr?: number;
    } | null;
    const action = body?.action;
    if (!action || !['pause', 'resume', 'archive', 'set_budget'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    }

    const db = supabaseAdmin();

    const { data: campaign } = await db
      .from('ad_campaigns')
      .select('id, campaign_id, adset_id, ad_id, status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }
    if (!['ACTIVE', 'PAUSED'].includes(campaign.status) && action !== 'archive') {
      return NextResponse.json({ error: `This campaign is ${campaign.status.toLowerCase()} and can't be changed.` }, { status: 409 });
    }

    const { data: config } = await db
      .from('meta_ads_config')
      .select('access_token, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!config || config.status !== 'connected') {
      return NextResponse.json({ error: 'Reconnect your Meta account to manage this campaign.' }, { status: 409 });
    }
    const accessToken = decrypt(config.access_token as string);

    try {
      if (action === 'pause') {
        // Pausing the campaign is sufficient — a paused ancestor halts
        // delivery for everything beneath it, even if the ad set/ad
        // are still ACTIVE.
        await setObjectStatus({ accessToken, objectId: campaign.campaign_id as string, status: 'PAUSED' });
        await db.from('ad_campaigns').update({ status: 'PAUSED', updated_at: new Date().toISOString() }).eq('id', id);
      } else if (action === 'resume') {
        // The inverse is NOT symmetric: un-pausing the campaign alone
        // does not resume children that are themselves paused, so all
        // three levels must be explicitly activated.
        await setObjectStatus({ accessToken, objectId: campaign.campaign_id as string, status: 'ACTIVE' });
        if (campaign.adset_id) await setObjectStatus({ accessToken, objectId: campaign.adset_id as string, status: 'ACTIVE' });
        if (campaign.ad_id) await setObjectStatus({ accessToken, objectId: campaign.ad_id as string, status: 'ACTIVE' });
        await db.from('ad_campaigns').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', id);
      } else if (action === 'archive') {
        await setObjectStatus({ accessToken, objectId: campaign.campaign_id as string, status: 'ARCHIVED' });
        await db.from('ad_campaigns').update({ status: 'ARCHIVED', updated_at: new Date().toISOString() }).eq('id', id);
      } else if (action === 'set_budget') {
        const validation = validateDailyBudgetInr(body?.daily_budget_inr);
        if (!validation.ok) {
          return NextResponse.json({ error: validation.reason }, { status: 400 });
        }
        if (!campaign.adset_id) {
          return NextResponse.json({ error: 'This campaign has no ad set to update.' }, { status: 409 });
        }
        const minor = inrToPaise(body!.daily_budget_inr!);
        // Budget lives on the ad set, not the campaign.
        await setAdSetDailyBudget({ accessToken, adsetId: campaign.adset_id as string, dailyBudgetMinor: minor });
        await db.from('ad_campaigns').update({ daily_budget_minor: minor, updated_at: new Date().toISOString() }).eq('id', id);
      }
    } catch (err) {
      if (isTokenError(err)) {
        await db.from('meta_ads_config').update({ status: 'token_expired' }).eq('account_id', ctx.accountId);
        return NextResponse.json({ error: 'Your Meta connection expired. Please reconnect.' }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

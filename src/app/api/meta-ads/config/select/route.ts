import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { listAdAccounts, listPages, isTokenError } from '@/lib/meta-ads/client';

// GET /api/meta-ads/config/select
// Lists the ad accounts / Pages the connected token can access, for
// the settings UI's asset-selection dropdowns.
export async function GET() {
  try {
    const ctx = await requireRole('owner');
    const admin = supabaseAdmin();

    const { data: config } = await admin
      .from('meta_ads_config')
      .select('access_token, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!config || config.status !== 'connected') {
      return NextResponse.json({ error: 'Connect your Meta account first.' }, { status: 409 });
    }

    const accessToken = decrypt(config.access_token as string);

    try {
      const [adAccounts, pages] = await Promise.all([listAdAccounts(accessToken), listPages(accessToken)]);
      return NextResponse.json({
        adAccounts: adAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
        pages: pages.map((p) => ({
          id: p.id,
          name: p.name,
          instagramAccountId: p.instagram_business_account?.id ?? null,
        })),
      });
    } catch (err) {
      if (isTokenError(err)) {
        await admin
          .from('meta_ads_config')
          .update({ status: 'token_expired', updated_at: new Date().toISOString() })
          .eq('account_id', ctx.accountId);
        return NextResponse.json({ error: 'Your Meta connection expired. Please reconnect.' }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/meta-ads/config/select
// Persists the ad account / Page (/ Instagram account) the owner
// chose after connecting. Re-validates both ids against the stored
// token's actual accessible assets — never trusts client-supplied ids
// directly, so a tampered request can't attach billing to an ad
// account the connected token doesn't actually have access to.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner');

    const body = (await request.json().catch(() => null)) as {
      ad_account_id?: string;
      page_id?: string;
    } | null;

    const adAccountId = body?.ad_account_id?.trim();
    const pageId = body?.page_id?.trim();
    if (!adAccountId || !pageId) {
      return NextResponse.json({ error: 'ad_account_id and page_id are required' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: config } = await admin
      .from('meta_ads_config')
      .select('access_token, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!config || config.status !== 'connected') {
      return NextResponse.json({ error: 'Connect your Meta account first.' }, { status: 409 });
    }

    const accessToken = decrypt(config.access_token as string);

    let adAccounts, pages;
    try {
      [adAccounts, pages] = await Promise.all([listAdAccounts(accessToken), listPages(accessToken)]);
    } catch (err) {
      if (isTokenError(err)) {
        await admin
          .from('meta_ads_config')
          .update({ status: 'token_expired', updated_at: new Date().toISOString() })
          .eq('account_id', ctx.accountId);
        return NextResponse.json({ error: 'Your Meta connection expired. Please reconnect.' }, { status: 409 });
      }
      throw err;
    }

    const selectedAdAccount = adAccounts.find((a) => a.id === adAccountId);
    const selectedPage = pages.find((p) => p.id === pageId);
    if (!selectedAdAccount || !selectedPage) {
      return NextResponse.json(
        { error: 'That ad account or Page is not accessible with your connected Meta login.' },
        { status: 400 },
      );
    }

    await admin
      .from('meta_ads_config')
      .update({
        ad_account_id: selectedAdAccount.id,
        page_id: selectedPage.id,
        ig_account_id: selectedPage.instagram_business_account?.id ?? null,
        currency: selectedAdAccount.currency,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

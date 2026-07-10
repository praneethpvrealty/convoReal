import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  uploadAdImage,
  createCampaign,
  createAdSet,
  createAdCreative,
  createAd,
  setObjectStatus,
  deleteObject,
  resolveCityGeoKey,
  isTokenError,
  MetaAdsApiError,
} from '@/lib/meta-ads/client';
import {
  inrToPaise,
  validateDailyBudgetInr,
  clampRadiusKm,
  buildTargeting,
} from '@/lib/meta-ads/campaign-build';

// POST /api/meta-ads/campaigns
// Creates a Click-to-WhatsApp campaign promoting one property.
//
// Every Meta object is created PAUSED; the campaign is flipped ACTIVE
// only as the very last step, after the local row is written. If any
// step fails, the objects already created are deleted (reverse order)
// and nothing is left running or half-recorded — a partial failure can
// never leave an ad silently spending the agent's money.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  property_id?: string;
  daily_budget_inr?: number;
  duration_days?: number;
  radius_km?: number;
  headline?: string;
  primary_text?: string;
  image_url?: string;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const gate = await checkPlanLimit(ctx, 'meta_ads');
    if (!gate.allowed) return gateResponse(gate);

    const body = (await request.json().catch(() => null)) as Body | null;
    const propertyId = body?.property_id;
    const headline = (body?.headline || '').trim();
    const primaryText = (body?.primary_text || '').trim();
    const imageUrl = (body?.image_url || '').trim();
    const radiusKm = clampRadiusKm(body?.radius_km);

    if (!propertyId || !UUID_RE.test(propertyId)) {
      return NextResponse.json({ error: 'Invalid property.' }, { status: 400 });
    }
    if (!headline || !primaryText) {
      return NextResponse.json({ error: 'Ad headline and text are required.' }, { status: 400 });
    }
    const budget = validateDailyBudgetInr(body?.daily_budget_inr);
    if (!budget.ok) {
      return NextResponse.json({ error: budget.reason }, { status: 400 });
    }

    const db = supabaseAdmin();

    // Connection must be present, connected, and asset-selected.
    const { data: config } = await db
      .from('meta_ads_config')
      .select('access_token, status, ad_account_id, page_id, ig_account_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!config || config.status !== 'connected' || !config.ad_account_id || !config.page_id) {
      return NextResponse.json({ error: 'Connect your Meta account and select an ad account first.' }, { status: 409 });
    }

    // Property must belong to the account and have at least one image.
    const { data: property } = await db
      .from('properties')
      .select('id, title, property_code, images, latitude, longitude, city, location')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
    }
    const images: string[] = Array.isArray(property.images) ? property.images : [];
    // The chosen image must be one of the property's own photos.
    const chosenImage = imageUrl && images.includes(imageUrl) ? imageUrl : images[0];
    if (!chosenImage) {
      return NextResponse.json({ error: 'Add at least one photo to this property before advertising it.' }, { status: 400 });
    }

    // One live campaign per property (the unique index also enforces
    // this, but check first for a friendly message).
    const { data: existing } = await db
      .from('ad_campaigns')
      .select('id')
      .eq('property_id', propertyId)
      .in('status', ['ACTIVE', 'PAUSED'])
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'This property already has a running ad. Stop it before creating a new one.' }, { status: 409 });
    }

    // Business WhatsApp number the ad opens a chat with.
    const { data: settings } = await db
      .from('showcase_settings')
      .select('contact_phone')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const cleanPhone = (settings?.contact_phone || '').replace(/\D/g, '');
    if (!cleanPhone) {
      return NextResponse.json({ error: 'Set your WhatsApp contact number in Showcase settings first.' }, { status: 409 });
    }
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
      `Hi! I'm interested in ${property.title}${property.property_code ? ` (${property.property_code})` : ''}`,
    )}`;

    const accessToken = decrypt(config.access_token as string);
    const adAccountId = config.ad_account_id as string;
    const pageId = config.page_id as string;

    // Targeting: radius around coordinates when available, else the
    // property's city resolved to a Meta geo key.
    let targeting: Record<string, unknown>;
    let precise = true;
    const built = buildTargeting(property, radiusKm);
    if (built.precise && built.targeting) {
      targeting = built.targeting;
    } else {
      precise = false;
      if (!built.cityFallback) {
        return NextResponse.json(
          { error: 'This property has no location set. Add a city or map location to advertise it.' },
          { status: 400 },
        );
      }
      let cityKey: string | null;
      try {
        cityKey = await resolveCityGeoKey(accessToken, built.cityFallback);
      } catch (err) {
        if (isTokenError(err)) {
          await db.from('meta_ads_config').update({ status: 'token_expired' }).eq('account_id', ctx.accountId);
          return NextResponse.json({ error: 'Your Meta connection expired. Please reconnect.' }, { status: 409 });
        }
        throw err;
      }
      if (!cityKey) {
        return NextResponse.json(
          { error: `Couldn't match "${built.cityFallback}" to a city. Add a map location to this property instead.` },
          { status: 400 },
        );
      }
      targeting = { geo_locations: { cities: [{ key: cityKey }] }, age_min: 22 };
    }

    const endTime =
      body?.duration_days && body.duration_days > 0
        ? new Date(Date.now() + body.duration_days * 24 * 60 * 60 * 1000).toISOString()
        : null;

    // ── The create sequence (PAUSED-first, activate-last) ────────────
    const created: { creativeId?: string; adId?: string; adsetId?: string; campaignId?: string } = {};
    const scoped = { accessToken, adAccountId };
    const namePrefix = `ConvoReal – ${property.property_code || property.title}`.slice(0, 60);

    try {
      const imgRes = await fetch(chosenImage);
      if (!imgRes.ok) throw new MetaAdsApiError('Could not read the property image', 0, undefined, 'Image unavailable');
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      const imageHash = await uploadAdImage({ ...scoped, bytes });

      created.campaignId = await createCampaign({
        ...scoped,
        name: namePrefix,
        // India-targeted real-estate ads are not in Meta's Special Ad
        // Category today. If ever targeting US/CA, pass ['HOUSING'].
        specialAdCategories: [],
      });

      created.adsetId = await createAdSet({
        ...scoped,
        name: `${namePrefix} – adset`,
        campaignId: created.campaignId,
        pageId,
        dailyBudgetMinor: inrToPaise(body!.daily_budget_inr!),
        targeting,
        endTime,
      });

      created.creativeId = await createAdCreative({
        ...scoped,
        name: `${namePrefix} – creative`,
        pageId,
        igAccountId: config.ig_account_id as string | null,
        message: primaryText,
        headline,
        imageHash,
        waLink,
      });

      created.adId = await createAd({
        ...scoped,
        name: `${namePrefix} – ad`,
        adsetId: created.adsetId,
        creativeId: created.creativeId,
      });

      // Record locally (still PAUSED) before flipping live, so an
      // activation failure leaves a recoverable ERROR row rather than a
      // running ad we never tracked.
      const { data: row, error: insErr } = await db
        .from('ad_campaigns')
        .insert({
          account_id: ctx.accountId,
          property_id: propertyId,
          campaign_id: created.campaignId,
          adset_id: created.adsetId,
          ad_id: created.adId,
          creative_id: created.creativeId,
          status: 'PAUSED',
          daily_budget_minor: inrToPaise(body!.daily_budget_inr!),
          headline,
          primary_text: primaryText,
          image_url: chosenImage,
          radius_km: precise ? radiusKm : null,
          end_at: endTime,
          created_by: ctx.userId,
        })
        .select('id')
        .single();
      if (insErr || !row) throw insErr || new Error('Failed to record campaign');

      // Final step: go live.
      try {
        await setObjectStatus({ accessToken, objectId: created.campaignId, status: 'ACTIVE' });
        await db.from('ad_campaigns').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', row.id);
      } catch (activateErr) {
        // Objects exist and are recorded but couldn't go live — mark
        // ERROR (keeps the row out of the one-active-per-property index)
        // so the dashboard can surface a retry rather than orphaning it.
        await db.from('ad_campaigns').update({ status: 'ERROR', updated_at: new Date().toISOString() }).eq('id', row.id);
        console.error('[POST /api/meta-ads/campaigns] activation failed:', activateErr);
        return NextResponse.json(
          { error: 'Your ad was created but could not be activated. Please try again from the Ads dashboard.' },
          { status: 502 },
        );
      }

      return NextResponse.json({ success: true, campaignId: created.campaignId, precise });
    } catch (seqErr) {
      // Roll back every Meta object created so far, newest first.
      if (created.adId) await deleteObject(accessToken, created.adId);
      if (created.creativeId) await deleteObject(accessToken, created.creativeId);
      if (created.adsetId) await deleteObject(accessToken, created.adsetId);
      if (created.campaignId) await deleteObject(accessToken, created.campaignId);

      if (isTokenError(seqErr)) {
        await db.from('meta_ads_config').update({ status: 'token_expired' }).eq('account_id', ctx.accountId);
        return NextResponse.json({ error: 'Your Meta connection expired. Please reconnect.' }, { status: 409 });
      }
      const msg = seqErr instanceof MetaAdsApiError ? seqErr.userMessage : 'Could not create the ad. Please try again.';
      console.error('[POST /api/meta-ads/campaigns] create sequence failed:', seqErr);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

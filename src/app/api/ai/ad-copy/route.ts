import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { generateText } from '@/lib/ai/gemini';
import { buildAdCopyPrompt, parseAdCopy, AD_COPY_SYSTEM_PROMPT } from '@/lib/meta-ads/ad-copy';

// POST /api/ai/ad-copy
// Generates Click-to-WhatsApp ad copy (primary text / headline /
// description) from a property. Solo Pro+ (Meta Ads gate), credit-
// metered like other AI features — hard-gated (owner/agent-initiated,
// so no free fallback), burned before the Gemini call and refunded if
// it fails, per the credit-engine convention.
const AI_FEATURE = 'ad_copy' as const;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const gate = await checkPlanLimit(ctx, 'meta_ads');
    if (!gate.allowed) return gateResponse(gate);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI is not configured on this server.' }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { property_id?: string } | null;
    const propertyId = body?.property_id;
    if (!propertyId) {
      return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
    }

    // Load the property, scoped to the caller's account (RLS-scoped
    // client — a forged id from another tenant finds nothing).
    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id, title, type, location, city, listing_type, price, rent_per_month, bedrooms, area_sqft, features, nearby_highlights, owner_share_percent, builder_share_percent')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const cost = AI_FEATURE_COSTS[AI_FEATURE];
    const burn = await burnCredits(ctx.accountId, AI_FEATURE, cost, { client: ctx.supabase });
    if (!burn.success) {
      return NextResponse.json(
        { error: 'Insufficient credits to generate ad copy.', creditsNeeded: cost, upgradeRequired: true },
        { status: 402 },
      );
    }

    let raw: string;
    try {
      raw = await generateText(buildAdCopyPrompt(property), AD_COPY_SYSTEM_PROMPT, { feature: 'ad_copy' });
    } catch (apiErr) {
      await refundCredits(ctx.accountId, AI_FEATURE, cost, { client: ctx.supabase });
      throw apiErr;
    }

    const copy = parseAdCopy(raw);
    if (!copy) {
      // Model returned unusable output — refund and let the user retry.
      await refundCredits(ctx.accountId, AI_FEATURE, cost, { client: ctx.supabase });
      return NextResponse.json({ error: 'Could not generate ad copy. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ copy });
  } catch (err) {
    return toErrorResponse(err);
  }
}

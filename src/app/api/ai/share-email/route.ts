import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { burnCredits, refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { generateText } from '@/lib/ai/gemini';
import {
  buildShareEmailAiPrompt,
  parseAiShareEmail,
  SHARE_EMAIL_SYSTEM_PROMPT,
  type ShareEmailProperty,
} from '@/lib/email/property-share-email';

// POST /api/ai/share-email
// Rewrites the deterministic "Share via Email" draft for a property into
// a polished professional email. Credit-metered like the other AI
// features — hard-gated (agent-initiated), burned before the Gemini call
// and refunded if it fails, per the credit-engine convention.
const AI_FEATURE = 'share_email' as const;

const PROPERTY_COLUMNS =
  'id, is_published, title, type, listing_type, price, rent_per_month, maintenance, ' +
  'location, sublocality, city, google_map_link, nearby_highlights, ' +
  'land_area, land_area_unit, land_zone, land_use_zoning, ownership_status, ' +
  'deal_remarks, jv_structure, owner_share_percent, builder_share_percent, ' +
  'goodwill_amount, documents, property_code, images';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const gate = await checkPlanLimit(ctx, 'ai');
    if (!gate.allowed) return gateResponse(gate);

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI is not configured on this server.' }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as {
      property_id?: string;
      recipient_names?: string[];
      agent_name?: string;
      agent_phone?: string;
      showcase_base_url?: string;
    } | null;
    const propertyId = body?.property_id;
    if (!propertyId) {
      return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
    }

    const recipientNames = Array.isArray(body?.recipient_names)
      ? body.recipient_names.filter((n): n is string => typeof n === 'string').slice(0, 10)
      : [];

    // Load the property, scoped to the caller's account (RLS-scoped
    // client — a forged id from another tenant finds nothing).
    const { data: property } = await ctx.supabase
      .from('properties')
      .select(PROPERTY_COLUMNS)
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
        { error: 'Insufficient credits to draft the email.', creditsNeeded: cost, upgradeRequired: true },
        { status: 402 },
      );
    }

    // Untyped supabase client can't infer the row shape from the column
    // string — same convention as the public similar-properties route.
    const prompt = buildShareEmailAiPrompt(property as unknown as ShareEmailProperty, {
      recipientNames,
      agentName: typeof body?.agent_name === 'string' ? body.agent_name : null,
      agentPhone: typeof body?.agent_phone === 'string' ? body.agent_phone : null,
      showcaseBaseUrl: typeof body?.showcase_base_url === 'string' ? body.showcase_base_url : null,
    });

    let raw: string;
    try {
      raw = await generateText(prompt, SHARE_EMAIL_SYSTEM_PROMPT, { feature: 'share_email' });
    } catch (apiErr) {
      await refundCredits(ctx.accountId, AI_FEATURE, cost, { client: ctx.supabase });
      throw apiErr;
    }

    const draft = parseAiShareEmail(raw);
    if (!draft) {
      // Model returned unusable output — refund and let the user retry.
      await refundCredits(ctx.accountId, AI_FEATURE, cost, { client: ctx.supabase });
      return NextResponse.json({ error: 'Could not draft the email. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ draft });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const SEED_CHUNK = 500;

// GET /api/voice-campaigns — campaigns with per-status recipient counts
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: campaigns, error } = await ctx.supabase
      .from('voice_campaigns')
      .select(
        'id, name, property_id, agent_ref, status, call_window_start_hour, call_window_end_hour, max_attempts, script_context, created_at, updated_at'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: counts } = await ctx.supabase.rpc(
      'voice_campaign_recipient_counts',
      {
        target_account_id: ctx.accountId,
      }
    );
    const byCampaign = new Map<string, Record<string, number>>();
    for (const row of (counts ?? []) as {
      campaign_id: string;
      status: string;
      recipients: number;
    }[]) {
      const entry = byCampaign.get(row.campaign_id) ?? {};
      entry[row.status] = Number(row.recipients);
      byCampaign.set(row.campaign_id, entry);
    }

    return NextResponse.json({
      data: (campaigns ?? []).map((c) => ({
        ...c,
        recipient_counts: byCampaign.get(c.id) ?? {},
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/voice-campaigns — create a campaign, optionally seeding
// recipients from the property's enquiries
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `agent:createVoiceCampaign:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const startHour = Number(body.call_window_start_hour ?? 10);
    const endHour = Number(body.call_window_end_hour ?? 19);
    const maxAttempts = Number(body.max_attempts ?? 3);
    if (
      !Number.isInteger(startHour) ||
      !Number.isInteger(endHour) ||
      startHour < 0 ||
      startHour > 23 ||
      endHour < 1 ||
      endHour > 24 ||
      startHour >= endHour
    ) {
      return NextResponse.json(
        { error: 'Invalid call window' },
        { status: 400 }
      );
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      return NextResponse.json(
        { error: 'Invalid max_attempts' },
        { status: 400 }
      );
    }

    const propertyId =
      typeof body.property_id === 'string' ? body.property_id : null;
    let scriptContext: Record<string, string> = {};
    if (propertyId) {
      const { data: property } = await ctx.supabase
        .from('properties')
        .select('id, title, price, location, sublocality')
        .eq('account_id', ctx.accountId)
        .eq('id', propertyId)
        .maybeSingle();
      if (!property) {
        return NextResponse.json(
          { error: 'Property not found' },
          { status: 404 }
        );
      }
      scriptContext = {
        property_title: property.title ?? '',
        asking_price: property.price != null ? String(property.price) : '',
        locality: property.sublocality || property.location || '',
      };
    }

    const { data: campaign, error: insertErr } = await ctx.supabase
      .from('voice_campaigns')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name: body.name.trim().slice(0, 200),
        property_id: propertyId,
        agent_ref:
          typeof body.agent_ref === 'string' &&
          body.agent_ref.trim()
            ? body.agent_ref.trim()
            : null,
        script_context: scriptContext,
        call_window_start_hour: startHour,
        call_window_end_hour: endHour,
        max_attempts: maxAttempts,
      })
      .select('id, name, property_id, status')
      .single();
    if (insertErr || !campaign) {
      return NextResponse.json(
        { error: insertErr?.message || 'Failed to create campaign' },
        { status: 500 }
      );
    }

    let seeded = 0;
    const seedFromProperty = propertyId && body.seed_from_property !== false;
    if (seedFromProperty) {
      const { data: inquiries } = await ctx.supabase
        .from('contact_property_inquiries')
        .select('contact_id')
        .eq('account_id', ctx.accountId)
        .eq('property_id', propertyId);
      const contactIds = [
        ...new Set((inquiries ?? []).map((i) => i.contact_id)),
      ];
      if (contactIds.length > 0) {
        // Chunked .in() — an unbounded id list travels in the URL (§2.6).
        const callable: { id: string }[] = [];
        for (let i = 0; i < contactIds.length; i += 200) {
          const { data } = await ctx.supabase
            .from('contacts')
            .select('id')
            .eq('account_id', ctx.accountId)
            .in('id', contactIds.slice(i, i + 200))
            .not('phone', 'is', null)
            .eq('do_not_call', false)
            .eq('is_merged', false);
          callable.push(...(data ?? []));
        }
        const rows = callable.map((c) => ({
          account_id: ctx.accountId,
          campaign_id: campaign.id,
          contact_id: c.id,
        }));
        for (let i = 0; i < rows.length; i += SEED_CHUNK) {
          const chunk = rows.slice(i, i + SEED_CHUNK);
          const { data: insertedRows } = await ctx.supabase
            .from('voice_campaign_recipients')
            .upsert(chunk, {
              onConflict: 'campaign_id,contact_id',
              ignoreDuplicates: true,
            })
            .select('id');
          seeded += insertedRows?.length ?? 0;
        }
      }
    }

    return NextResponse.json({ data: { ...campaign, seeded } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

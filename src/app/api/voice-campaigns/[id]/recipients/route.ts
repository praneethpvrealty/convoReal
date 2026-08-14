import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const MAX_BATCH = 1000;
const LOOKUP_CHUNK = 200;

function parseContactIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null;
  const ids = (body as { contact_ids?: unknown }).contact_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH)
    return null;
  const cleaned = [
    ...new Set(ids.filter((i): i is string => typeof i === 'string')),
  ];
  return cleaned.length > 0 ? cleaned : null;
}

// POST /api/voice-campaigns/[id]/recipients — add contacts to a campaign
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const contactIds = parseContactIds(await request.json().catch(() => null));
    if (!contactIds) {
      return NextResponse.json(
        {
          error: `contact_ids must be a non-empty array of at most ${MAX_BATCH} ids`,
        },
        { status: 400 }
      );
    }

    const { data: campaign } = await ctx.supabase
      .from('voice_campaigns')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    // Chunked .in() — an unbounded id list travels in the URL (§2.6).
    const callable: { id: string }[] = [];
    for (let i = 0; i < contactIds.length; i += LOOKUP_CHUNK) {
      const { data } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .in('id', contactIds.slice(i, i + LOOKUP_CHUNK))
        .not('phone', 'is', null)
        .eq('do_not_call', false)
        .eq('is_merged', false);
      callable.push(...(data ?? []));
    }

    let added = 0;
    for (let i = 0; i < callable.length; i += LOOKUP_CHUNK) {
      const chunk = callable.slice(i, i + LOOKUP_CHUNK).map((c) => ({
        account_id: ctx.accountId,
        campaign_id: id,
        contact_id: c.id,
      }));
      const { data: inserted } = await ctx.supabase
        .from('voice_campaign_recipients')
        .upsert(chunk, {
          onConflict: 'campaign_id,contact_id',
          ignoreDuplicates: true,
        })
        .select('id');
      added += inserted?.length ?? 0;
    }

    return NextResponse.json({
      data: { added, skipped: contactIds.length - added },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/voice-campaigns/[id]/recipients — remove contacts from a campaign
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const contactIds = parseContactIds(await request.json().catch(() => null));
    if (!contactIds) {
      return NextResponse.json(
        {
          error: `contact_ids must be a non-empty array of at most ${MAX_BATCH} ids`,
        },
        { status: 400 }
      );
    }

    let removed = 0;
    for (let i = 0; i < contactIds.length; i += LOOKUP_CHUNK) {
      const { data: deleted } = await ctx.supabase
        .from('voice_campaign_recipients')
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('campaign_id', id)
        .in('contact_id', contactIds.slice(i, i + LOOKUP_CHUNK))
        .select('id');
      removed += deleted?.length ?? 0;
    }

    return NextResponse.json({ data: { removed } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

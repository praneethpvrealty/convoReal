import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// Property Ratings — a one-tap 1–10 "how well does this fit?" signal from
// public showcase visitors (see migration 159). Replaces the binary
// Like / Interested prompts with a graded interest score plus optional
// low-rating miss reasons that feed matching refinement. Unauthenticated
// like the showcase itself; defenses mirror property-likes/route.ts:
//   - per-session + per-account rate limits
//   - property-belongs-to-account check
//   - UNIQUE(session_key, property_id) makes re-rating an update
//   - ?ref is only recorded when it resolves to a contact IN that account
//
// A rating >= 7 also upserts a property_likes row (and < 7 removes it) so
// the agent-facing like_count keeps meaning "high-interest visitors".
//
// POST { account_id, property_id, session_key, rating, miss_reasons?, ref? }
// GET  ?account_id=&session_key= → { ratings, stats } for hydration.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATING_SESSION_LIMIT = { limit: 30, windowMs: 60_000 };
const RATING_ACCOUNT_LIMIT = { limit: 300, windowMs: 60_000 };
const HIGH_INTEREST_THRESHOLD = 7;

const MISS_REASONS = [
  'budget',
  'location',
  'property_type',
  'size',
  'other',
] as const;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      property_id?: string;
      session_key?: string;
      rating?: number;
      miss_reasons?: string[];
      ref?: string;
    } | null;

    const accountId = body?.account_id;
    const propertyId = body?.property_id;
    const sessionKey = (body?.session_key || '').slice(0, 64);
    const rating = body?.rating;
    const missReasons = Array.isArray(body?.miss_reasons)
      ? body.miss_reasons.filter((r): r is (typeof MISS_REASONS)[number] =>
          (MISS_REASONS as readonly string[]).includes(r)
        )
      : [];

    if (
      !accountId ||
      !UUID_RE.test(accountId) ||
      !propertyId ||
      !UUID_RE.test(propertyId) ||
      !sessionKey ||
      typeof rating !== 'number' ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 10
    ) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const sessionLimit = checkRateLimit(
      `ratings:session:${sessionKey}`,
      RATING_SESSION_LIMIT
    );
    if (!sessionLimit.success) return rateLimitResponse(sessionLimit);
    const accountLimit = checkRateLimit(
      `ratings:account:${accountId}`,
      RATING_ACCOUNT_LIMIT
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const db = supabaseAdmin();

    // The property must exist and belong to this account — a forged
    // property_id from another tenant must never be rated here.
    const { data: property } = await db
      .from('properties')
      .select('id')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    // Resolve ref → contact, but only within this account.
    let contactId: string | null = null;
    if (body?.ref && UUID_RE.test(body.ref)) {
      const { data: contact } = await db
        .from('contacts')
        .select('id')
        .eq('id', body.ref)
        .eq('account_id', accountId)
        .maybeSingle();
      contactId = contact?.id ?? null;
    }

    const { error } = await db.from('property_ratings').upsert(
      {
        account_id: accountId,
        property_id: propertyId,
        contact_id: contactId,
        session_key: sessionKey,
        rating,
        miss_reasons: rating < HIGH_INTEREST_THRESHOLD ? missReasons : [],
      },
      { onConflict: 'session_key,property_id' }
    );
    if (error) {
      console.error('[property-ratings] upsert failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to record rating' },
        { status: 500 }
      );
    }

    // Keep like_count in step: >= 7 counts as a like, below removes it.
    if (rating >= HIGH_INTEREST_THRESHOLD) {
      const { error: likeError } = await db.from('property_likes').insert({
        account_id: accountId,
        property_id: propertyId,
        contact_id: contactId,
        session_key: sessionKey,
      });
      if (likeError && likeError.code !== '23505') {
        console.error(
          '[property-ratings] like sync failed:',
          likeError.message
        );
      }
    } else {
      await db
        .from('property_likes')
        .delete()
        .eq('property_id', propertyId)
        .eq('session_key', sessionKey);
    }

    const { data: updated } = await db
      .from('properties')
      .select('rating_count, rating_total')
      .eq('id', propertyId)
      .maybeSingle();

    const count = updated?.rating_count ?? 0;
    const total = updated?.rating_total ?? 0;
    return NextResponse.json({
      rating,
      count,
      average: count > 0 ? Math.round((total / count) * 10) / 10 : null,
    });
  } catch (err) {
    console.error('[POST /api/public/property-ratings] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id') || '';
    const sessionKey = (searchParams.get('session_key') || '').slice(0, 64);

    if (!accountId || !UUID_RE.test(accountId)) {
      return NextResponse.json({ ratings: {}, stats: {} });
    }

    const db = supabaseAdmin();

    const { data: properties } = await db
      .from('properties')
      .select('id, rating_count, rating_total')
      .eq('account_id', accountId)
      .eq('is_published', true);

    const stats: Record<string, { count: number; average: number | null }> = {};
    for (const p of properties || []) {
      const count = (p.rating_count as number) ?? 0;
      const total = (p.rating_total as number) ?? 0;
      stats[p.id as string] = {
        count,
        average: count > 0 ? Math.round((total / count) * 10) / 10 : null,
      };
    }

    const ratings: Record<string, { rating: number; miss_reasons: string[] }> =
      {};
    if (sessionKey) {
      const { data: rows } = await db
        .from('property_ratings')
        .select('property_id, rating, miss_reasons')
        .eq('account_id', accountId)
        .eq('session_key', sessionKey);
      for (const r of rows || []) {
        ratings[r.property_id as string] = {
          rating: r.rating as number,
          miss_reasons: (r.miss_reasons as string[]) ?? [],
        };
      }
    }

    return NextResponse.json({ ratings, stats });
  } catch (err) {
    console.error('[GET /api/public/property-ratings] Error:', err);
    return NextResponse.json({ ratings: {}, stats: {} });
  }
}

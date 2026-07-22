import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// Property Likes — a lightweight, anonymous thumbs-up from public
// showcase visitors (see migration 158). The showcase is unauthenticated,
// so this endpoint is too; defenses instead of auth mirror the Showcase
// Pulse beacon (showcase-events/route.ts):
//   - per-session rate limit
//   - account existence + property-belongs-to-account checks
//   - session_key + property_id uniqueness makes a like idempotent
//   - ?ref is only recorded when it resolves to a contact IN that account
//
// POST { account_id, property_id, session_key, liked, ref? } → toggle.
// GET  ?account_id=&session_key= → { counts, liked } for hydration.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIKE_SESSION_LIMIT = { limit: 30, windowMs: 60_000 };
const LIKE_ACCOUNT_LIMIT = { limit: 300, windowMs: 60_000 };

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      account_id?: string;
      property_id?: string;
      session_key?: string;
      liked?: boolean;
      ref?: string;
    } | null;

    const accountId = body?.account_id;
    const propertyId = body?.property_id;
    const sessionKey = (body?.session_key || '').slice(0, 64);
    const liked = body?.liked !== false;

    if (
      !accountId ||
      !UUID_RE.test(accountId) ||
      !propertyId ||
      !UUID_RE.test(propertyId) ||
      !sessionKey
    ) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const sessionLimit = checkRateLimit(
      `likes:session:${sessionKey}`,
      LIKE_SESSION_LIMIT
    );
    if (!sessionLimit.success) return rateLimitResponse(sessionLimit);
    const accountLimit = checkRateLimit(
      `likes:account:${accountId}`,
      LIKE_ACCOUNT_LIMIT
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const db = supabaseAdmin();

    // The property must exist and belong to this account — a forged
    // property_id from another tenant must never be liked here.
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

    if (liked) {
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

      const { error } = await db.from('property_likes').insert({
        account_id: accountId,
        property_id: propertyId,
        contact_id: contactId,
        session_key: sessionKey,
      });
      // 23505 = already liked by this session; idempotent no-op.
      if (error && error.code !== '23505') {
        console.error('[property-likes] insert failed:', error.message);
        return NextResponse.json(
          { error: 'Failed to record like' },
          { status: 500 }
        );
      }
    } else {
      const { error } = await db
        .from('property_likes')
        .delete()
        .eq('property_id', propertyId)
        .eq('session_key', sessionKey);
      if (error) {
        console.error('[property-likes] delete failed:', error.message);
        return NextResponse.json(
          { error: 'Failed to remove like' },
          { status: 500 }
        );
      }
    }

    const { data: updated } = await db
      .from('properties')
      .select('like_count')
      .eq('id', propertyId)
      .maybeSingle();

    return NextResponse.json({ liked, count: updated?.like_count ?? 0 });
  } catch (err) {
    console.error('[POST /api/public/property-likes] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id') || '';
    const sessionKey = (searchParams.get('session_key') || '').slice(0, 64);

    if (!accountId || !UUID_RE.test(accountId)) {
      return NextResponse.json({ counts: {}, liked: [] });
    }

    const db = supabaseAdmin();

    const { data: properties } = await db
      .from('properties')
      .select('id, like_count')
      .eq('account_id', accountId)
      .eq('is_published', true);

    const counts: Record<string, number> = {};
    for (const p of properties || []) {
      counts[p.id as string] = (p.like_count as number) ?? 0;
    }

    let liked: string[] = [];
    if (sessionKey) {
      const { data: rows } = await db
        .from('property_likes')
        .select('property_id')
        .eq('account_id', accountId)
        .eq('session_key', sessionKey);
      liked = (rows || []).map((r) => r.property_id as string);
    }

    return NextResponse.json({ counts, liked });
  } catch (err) {
    console.error('[GET /api/public/property-likes] Error:', err);
    return NextResponse.json({ counts: {}, liked: [] });
  }
}

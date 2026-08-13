import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

// POST /api/properties/bulk-tags   { propertyIds, add?, remove? }
//
// Tagging is a per-project act more often than a per-listing one — four
// villas in one development all want "APM" — and doing it a listing at a
// time is four trips through the editor and four chances to type it
// differently. A tag spelled two ways is worse than no tag: the search
// still returns results, so nothing looks broken while half the project
// is missing from them.
//
// The merge itself is one statement (bulk_tag_properties, migration
// 266). Reading each array, merging here and writing it back would be a
// round trip per listing, and two agents tagging overlapping selections
// would each overwrite the other's array wholesale.

/** Enough for a whole project or a filtered page, not enough for someone
 *  to retag the entire inventory by accident. */
const MAX_PROPERTIES = 200;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `properties:bulk-tags:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const propertyIds: string[] = Array.isArray(body?.propertyIds)
      ? body.propertyIds.filter((id: unknown) => typeof id === 'string')
      : [];
    const clean = (v: unknown): string[] =>
      Array.isArray(v)
        ? Array.from(
            new Set(
              v
                .filter((t): t is string => typeof t === 'string')
                .map((t) => t.trim())
                .filter(Boolean)
            )
          )
        : [];
    const add = clean(body?.add);
    const remove = clean(body?.remove);

    if (propertyIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one listing.' },
        { status: 400 }
      );
    }
    if (propertyIds.length > MAX_PROPERTIES) {
      return NextResponse.json(
        { error: `Up to ${MAX_PROPERTIES} listings at a time.` },
        { status: 400 }
      );
    }
    if (add.length === 0 && remove.length === 0) {
      return NextResponse.json(
        { error: 'Nothing to add or remove.' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase.rpc('bulk_tag_properties', {
      target_account_id: ctx.accountId,
      property_ids: propertyIds,
      add_tags: add,
      remove_tags: remove,
    });
    if (error) throw error;

    const updated = (data ?? []) as Array<{ id: string; tags: string[] }>;
    // The function scopes by account itself, so a selection reaching
    // across tenants comes back short rather than erroring — report what
    // actually changed instead of what was asked for.
    return NextResponse.json({
      data: {
        updated: updated.length,
        requested: propertyIds.length,
        add,
        remove,
      },
    });
  } catch (err) {
    console.error('[POST /api/properties/bulk-tags] Unexpected error:', err);
    return toErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { parsePublicProfilePatch } from '@/lib/showcase/public-profile-settings';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');
    const limit = await checkRateLimit(
      `showcase-public-profile:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parsePublicProfilePatch(
      await request.json().catch(() => null)
    );
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      account_id: ctx.accountId,
      updated_at: new Date().toISOString(),
    };
    if (parsed.value.description !== undefined) {
      update.public_business_description = parsed.value.description;
    }
    if (parsed.value.areasServed !== undefined) {
      update.public_areas_served = parsed.value.areasServed;
    }
    if (parsed.value.propertyExpertise !== undefined) {
      update.public_property_expertise = parsed.value.propertyExpertise;
    }

    const { data, error } = await ctx.supabase
      .from('showcase_settings')
      .upsert(update, { onConflict: 'account_id' })
      .select(
        'public_business_description, public_areas_served, public_property_expertise, updated_at'
      )
      .single();
    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

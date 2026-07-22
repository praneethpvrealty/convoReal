// ============================================================
// /api/buyer/preferences — the buyer's matching preferences.
//
// Reads and writes the SAME contacts columns as the agent contact
// form and the WhatsApp preference flow. Preferences describe the
// buyer, not an agency relationship, so GET surfaces the most
// recently updated linked contact's values and PUT applies the
// update to EVERY active linked contact — all agencies see the same
// picture, and the matching engine picks the change up everywhere.
// ============================================================

import { NextResponse } from 'next/server';

import { UserFacingError } from '@/lib/auth/account';
import { withBuyerAuth, buyerAdmin } from '@/lib/buyer/auth';
import {
  parseBuyerPreferenceBody,
  BUYER_PROPERTY_INTEREST_OPTIONS,
} from '@/lib/buyer/preferences';

export const GET = withBuyerAuth(async (ctx) => {
  if (ctx.links.length === 0) {
    return NextResponse.json({
      preferences: null,
      property_interest_options: BUYER_PROPERTY_INTEREST_OPTIONS,
    });
  }

  const { data, error } = await buyerAdmin()
    .from('contacts')
    .select(
      'id, min_budget, max_budget, areas_of_interest, property_interests, min_roi, updated_at'
    )
    .in(
      'id',
      ctx.links.map((l) => l.contactId)
    )
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[buyer/preferences GET] fetch failed:', error);
    return NextResponse.json(
      { error: 'Could not load preferences' },
      { status: 500 }
    );
  }

  const contact = data?.[0] ?? null;
  return NextResponse.json({
    preferences: contact
      ? {
          min_budget: contact.min_budget ?? null,
          max_budget: contact.max_budget ?? null,
          areas_of_interest: contact.areas_of_interest ?? [],
          property_interests: contact.property_interests ?? [],
          min_roi: contact.min_roi ?? null,
        }
      : null,
    property_interest_options: BUYER_PROPERTY_INTEREST_OPTIONS,
  });
});

export const PUT = withBuyerAuth(async (ctx, req) => {
  if (ctx.links.length === 0) {
    throw new UserFacingError(
      'No linked agency yet — share your requirements on a showcase first'
    );
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) throw new UserFacingError('Invalid request body');

  const update = parseBuyerPreferenceBody(body);
  if (Object.keys(update).length === 0) {
    throw new UserFacingError('Nothing to update');
  }

  const { error } = await buyerAdmin()
    .from('contacts')
    .update({ ...update, updated_at: new Date().toISOString() })
    .in(
      'id',
      ctx.links.map((l) => l.contactId)
    );

  if (error) {
    console.error('[buyer/preferences PUT] update failed:', error);
    return NextResponse.json(
      { error: 'Could not save preferences' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
});

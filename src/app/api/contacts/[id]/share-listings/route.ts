import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { buyerAdmin } from '@/lib/buyer/auth';
import {
  buildPortfolioNudge,
  isPortfolioLinked,
  MAX_SHARED_LISTINGS,
  mirrorSharedListingsToPortfolio,
  portfolioLoginUrl,
} from '@/lib/buyer/shared-listings';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { logPropertyShare } from '@/lib/whatsapp/share-property-send';

// GET  /api/contacts/[id]/share-listings → whether this contact already
//      has a Portfolio account, the Portfolio sign-in link, and the nudge
//      line both surfaces append to a hand-picked share.
// POST /api/contacts/[id]/share-listings { property_ids }
//      Records the listings on the share ledger and saves them to the
//      contact's Portfolio shortlist when they have an account; a buyer
//      without one gets the same rows on first login.

type RouteParams = { params: Promise<{ id: string }> };

async function loadContact(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  contactId: string
) {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, classification')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    name: string | null;
    phone: string | null;
    classification: string | null;
  } | null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');
    const contact = await loadContact(ctx.supabase, ctx.accountId, contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const count = Math.max(
      1,
      Number(new URL(request.url).searchParams.get('count')) || 1
    );
    const linked = await isPortfolioLinked(buyerAdmin(), {
      accountId: ctx.accountId,
      contactId: contact.id,
    });
    const url = portfolioLoginUrl();
    return NextResponse.json({
      data: {
        linked,
        portfolio_url: url,
        nudge: buildPortfolioNudge({ linked, url, count }),
      },
    });
  } catch (err) {
    console.error(
      '[GET /api/contacts/[id]/share-listings] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: contactId } = await params;
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `contact:share-listings:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as {
      property_ids?: unknown;
    };
    const propertyIds = [
      ...new Set(
        (Array.isArray(body.property_ids) ? body.property_ids : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ];
    if (propertyIds.length === 0) {
      return NextResponse.json(
        { error: 'Choose at least one property' },
        { status: 400 }
      );
    }
    if (propertyIds.length > MAX_SHARED_LISTINGS) {
      return NextResponse.json(
        {
          error: `Share no more than ${MAX_SHARED_LISTINGS} properties at a time`,
        },
        { status: 400 }
      );
    }

    const contact = await loadContact(ctx.supabase, ctx.accountId, contactId);
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { data: properties, error: propertiesError } = await ctx.supabase
      .from('properties')
      .select('id')
      .eq('account_id', ctx.accountId)
      .in('id', propertyIds);
    if (propertiesError) throw propertiesError;
    const ownedIds = (properties ?? []).map((row) => row.id as string);
    if (ownedIds.length === 0) {
      return NextResponse.json(
        { error: 'None of those properties belong to this account' },
        { status: 404 }
      );
    }

    for (const propertyId of ownedIds) {
      await logPropertyShare(
        ctx.supabase,
        ctx.accountId,
        ctx.userId,
        propertyId,
        contact.id,
        contact.classification,
        { journeyVisible: true }
      );
    }

    const portfolio = await mirrorSharedListingsToPortfolio(buyerAdmin(), {
      accountId: ctx.accountId,
      contactId: contact.id,
      propertyIds: ownedIds,
    });

    return NextResponse.json({
      data: {
        recorded: ownedIds.length,
        portfolio: { ...portfolio, url: portfolioLoginUrl() },
      },
    });
  } catch (err) {
    console.error(
      '[POST /api/contacts/[id]/share-listings] Unexpected error:',
      err
    );
    return toErrorResponse(err);
  }
}

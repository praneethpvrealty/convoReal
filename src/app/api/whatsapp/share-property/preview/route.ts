import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  accountBrandImage,
  accountBrandName,
} from '@/lib/showcase/account-showcase-url';
import { PROPERTY_SHARE_TEMPLATE_NAMES } from '@/lib/whatsapp/property-share-template';
import { buildSharePropertyPreview } from '@/lib/whatsapp/share-property-preview';
import { resolveSendLanguage } from '@/lib/whatsapp/template-language';
import type { MessageTemplate, Property } from '@/types';

// GET /api/whatsapp/share-property/preview?property_id=…&contact_id=…
//
// What a share of this listing looks like to a recipient outside the
// 24-hour window: the same template the send path would pick, rendered
// with the same params, plus the listing's own photos the agent may
// lead with. contact_id only personalises the greeting.

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('property_id') ?? '';
    const contactId = searchParams.get('contact_id') ?? '';
    if (!propertyId) {
      return NextResponse.json(
        { error: 'property_id is required' },
        { status: 400 }
      );
    }

    const [{ data: property, error: propertyErr }, { data: contact }] =
      await Promise.all([
        ctx.supabase
          .from('properties')
          .select('*')
          .eq('id', propertyId)
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        contactId
          ? ctx.supabase
              .from('contacts')
              .select('id, name')
              .eq('id', contactId)
              .eq('account_id', ctx.accountId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
    if (propertyErr) throw propertyErr;
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const [{ data: templateRows, error: templateErr }, brandImage, brandName, language] =
      await Promise.all([
        ctx.supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', ctx.accountId)
          .in('name', PROPERTY_SHARE_TEMPLATE_NAMES)
          .order('last_submitted_at', { ascending: false, nullsFirst: false }),
        accountBrandImage(ctx.supabase, ctx.accountId),
        accountBrandName(ctx.supabase, ctx.accountId),
        resolveSendLanguage(ctx.supabase, ctx.accountId, contactId || null),
      ]);
    if (templateErr) throw templateErr;

    return NextResponse.json({
      data: buildSharePropertyPreview({
        candidates: (templateRows ?? []) as MessageTemplate[],
        property: property as Property,
        contactName: (contact?.name as string | null) ?? null,
        brandName,
        brandImage,
        language,
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

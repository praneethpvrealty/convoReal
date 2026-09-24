import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import { normalizePhone, normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import type { PortalKey } from '@/lib/portals/post-kit';

interface IncomingOwnerLead {
  id?: string;
  portal?: PortalKey | string;
  url?: string;
  title?: string;
  price?: string;
  name?: string;
  phone?: string;
  rawText?: string;
  capturedAt?: number;
}

function parseLeadPrice(priceStr?: string | null): number {
  if (!priceStr || typeof priceStr !== 'string') return 0;
  const numMatch = priceStr.replace(/[^\d.]/g, '');
  const num = parseFloat(numMatch);
  if (isNaN(num) || num <= 0) return 0;

  const lower = priceStr.toLowerCase();
  if (lower.includes('cr') || lower.includes('crore')) {
    return Math.round(num * 10000000);
  }
  if (lower.includes('lac') || lower.includes('lakh')) {
    return Math.round(num * 100000);
  }
  if (lower.includes('k')) {
    return Math.round(num * 1000);
  }
  if (num < 1000) {
    return Math.round(num * 100000); // e.g. "50" -> 50 Lacs
  }
  return Math.round(num);
}

function inferPropertyType(title?: string | null): string {
  const t = (title || '').toLowerCase();
  if (t.includes('apartment') || t.includes('flat') || t.includes('bhk')) return 'Apartment';
  if (t.includes('villa') || t.includes('independent house')) return 'Villa';
  if (t.includes('plot') || t.includes('land') || t.includes('layout')) return 'Plot';
  if (t.includes('commercial') || t.includes('office') || t.includes('shop')) return 'Commercial';
  return 'Residential';
}

function getPortalLabel(portal?: string | null): string {
  if (portal === '99acres') return '99acres';
  if (portal === 'magicbricks') return 'MagicBricks';
  if (portal === 'housing') return 'Housing.com';
  return 'Portal';
}

/**
 * POST /api/inventory/import-owner-leads
 *
 * Imports owner leads scraped via the Portal Harvester Chrome extension.
 * For each lead:
 * 1. Finds or creates an Owner Contact (phone, classification: 'Owner', status: 'active').
 * 2. Creates a Property (linked to owner_contact_id, listing_source: 'owner', status: 'Available').
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `agent:importOwnerLeads:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();
    if (!body || !Array.isArray(body.leads)) {
      return NextResponse.json({ error: 'Invalid payload: expected an array of leads' }, { status: 400 });
    }

    const leads: IncomingOwnerLead[] = body.leads;
    if (leads.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const propGate = await checkPlanLimit(ctx, 'properties');
    if (!propGate.allowed) return gateResponse(propGate);

    let importedCount = 0;

    for (const lead of leads) {
      const rawPhone = String(lead.phone || '').trim();
      if (!rawPhone) continue;

      const digits = normalizePhone(rawPhone);
      if (digits.length < 10) continue;

      const normalizedPhone = normalizePhoneWithCountryCode(rawPhone);
      const portalLabel = getPortalLabel(lead.portal);

      // 1. Find or create the Owner Contact
      let contactId: string | null = null;
      const phoneCandidates = Array.from(new Set([rawPhone, normalizedPhone, digits, `+${digits}`])).filter(Boolean);

      const { data: existingContacts } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .in('phone', phoneCandidates)
        .limit(1);

      if (existingContacts && existingContacts.length > 0) {
        contactId = existingContacts[0].id;
      } else {
        const contactGate = await checkPlanLimit(ctx, 'contacts');
        if (!contactGate.allowed) return gateResponse(contactGate);

        const ownerName = typeof lead.name === 'string' && lead.name.trim() && lead.name.trim().toLowerCase() !== 'unknown owner'
          ? lead.name.trim()
          : 'Unknown Owner';

        const { data: newContact, error: contactError } = await ctx.supabase
          .from('contacts')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            name: ownerName,
            phone: normalizedPhone || rawPhone,
            classification: 'Owner',
            source: portalLabel,
            status: 'active',
          })
          .select('id')
          .single();

        if (contactError || !newContact) {
          console.error('[import-owner-leads] Contact insert failed:', contactError);
          continue;
        }
        contactId = newContact.id;
      }

      // 2. Create the Property listing linked to the owner
      if (contactId) {
        const title = lead.title?.trim()
          ? lead.title.trim().slice(0, 150)
          : `Owner Listing - ${portalLabel}`;

        // Avoid creating duplicate properties for the same owner and title
        const { data: existingProp } = await ctx.supabase
          .from('properties')
          .select('id')
          .eq('account_id', ctx.accountId)
          .eq('owner_contact_id', contactId)
          .eq('title', title)
          .limit(1);

        if (existingProp && existingProp.length > 0) {
          importedCount++;
          continue;
        }

        const price = parseLeadPrice(lead.price);
        const propType = inferPropertyType(lead.title);
        const notes = [
          lead.url ? `Portal URL: ${lead.url}` : null,
          lead.capturedAt ? `Captured on: ${new Date(lead.capturedAt).toISOString()}` : null,
        ].filter(Boolean).join('\n');

        const description = lead.rawText
          ? `Imported from ${portalLabel}.\n\n${lead.rawText.slice(0, 2000)}`
          : `Imported from ${portalLabel}.`;

        const { error: propertyError } = await ctx.supabase
          .from('properties')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            title,
            owner_contact_id: contactId,
            listing_source: 'owner',
            price,
            location: 'Unknown',
            type: propType,
            status: 'Available',
            is_published: false,
            description,
            notes: notes || null,
          });

        if (propertyError) {
          console.error('[import-owner-leads] Property insert failed:', propertyError);
        } else {
          importedCount++;
        }
      }
    }

    return NextResponse.json({ success: true, count: importedCount });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}


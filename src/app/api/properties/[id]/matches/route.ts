import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getMatchingContacts } from '@/lib/matching';
import { attachInquiredListingTypes } from '@/lib/contacts/inquired-intent';
import { fetchInquiredProperties } from '@/lib/contacts/inquired-properties';
import {
  loadListingMatchFeedback,
  loadTypeSuggestions,
} from '@/lib/inventory/match-feedback-store';
import { partitionMatchesByFeedback } from '@/lib/match-feedback';
import type { Contact, Property } from '@/types';

// Only the columns src/lib/matching.ts reads, plus what the caller needs
// to render and message a row — the same shape the web inventory fetches
// for its per-card match counts.
const MATCH_CONTACT_COLUMNS =
  'id, name, phone, classification, name_tag, requirements, requirement_profiles, requirement_active, ' +
  'min_budget, max_budget, no_budget, min_roi, property_interests, areas_of_interest, ' +
  'areas_of_interest_geo, projects_of_interest, strict_project_match, strict_area_match, ' +
  'pref_property_types, pref_property_categories, pref_bhk_min, pref_bhk_max, ' +
  'pref_budget_min, pref_budget_max, pref_budget_anchor, pref_land_area_min_sqft, pref_land_area_max_sqft, pref_areas, pref_excluded_areas, pref_projects, ' +
  'pref_min_roi, requires_tenanted, pref_requires_tenanted, pref_listing_types, pref_extracted_at, contact_notes(note_text)';

const HIDDEN_LOOKUP_CAP = 100;

// GET /api/properties/[id]/matches
// Scored contact matches for one listing, ranked best-first. The engine
// runs server-side so native clients share the web's ranking instead of
// carrying their own copy of it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: propertyId } = await params;

    const { data: property, error: propertyError } = await ctx.supabase
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (propertyError) {
      console.error('[GET /api/properties/[id]/matches]', propertyError);
      return NextResponse.json(
        { error: 'Failed to load property' },
        { status: 500 }
      );
    }
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    const { data: contacts, error: contactsError } = await ctx.supabase
      .from('contacts')
      .select(MATCH_CONTACT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .in('classification', ['Buyer', 'Agent']);

    if (contactsError) {
      console.error('[GET /api/properties/[id]/matches]', contactsError);
      return NextResponse.json(
        { error: 'Failed to load contacts' },
        { status: 500 }
      );
    }

    // Who this listing already went out to, so a client can mark those
    // rows instead of showing them as untouched. A read failure only
    // costs the marker, never the list.
    const { data: shares, error: sharesError } = await ctx.supabase
      .from('property_shares')
      .select('contact_id, created_at')
      .eq('account_id', ctx.accountId)
      .eq('property_id', propertyId);
    if (sharesError) {
      console.error('[GET /api/properties/[id]/matches]', sharesError);
    }
    const sharedAtByContact = new Map<string, string>(
      (shares ?? []).map((row) => [
        row.contact_id as string,
        row.created_at as string,
      ])
    );

    const ranked = getMatchingContacts(
      property as Property,
      await attachInquiredListingTypes(
        ctx.supabase,
        ctx.accountId,
        (contacts ?? []) as unknown as Contact[]
      )
    );

    // A contact ruled out for this listing — by the buyer on WhatsApp or
    // an agent's "Not a fit" — leaves the list and waits under hidden.
    const feedback = await loadListingMatchFeedback(
      ctx.supabase,
      ctx.accountId,
      propertyId
    );
    // A rejected contact may sit outside the Buyer/Agent pool above (an
    // audience member picked on mobile) or no longer rank at all once
    // their type was corrected; either way they stay restorable.
    const pool = (contacts ?? []) as unknown as Contact[];
    const pooled = new Set(pool.map((c) => c.id));
    const missingIds = feedback.marks
      .map((m) => m.contactId)
      .filter((id) => !pooled.has(id))
      .slice(0, HIDDEN_LOOKUP_CAP);
    const { data: missing, error: missingError } = missingIds.length
      ? await ctx.supabase
          .from('contacts')
          .select('id, name, phone, classification, name_tag')
          .eq('account_id', ctx.accountId)
          .in('id', missingIds)
      : { data: [], error: null };
    if (missingError) {
      console.error('[GET /api/properties/[id]/matches]', missingError);
    }
    const { visible: results, hidden } = partitionMatchesByFeedback(
      ranked,
      feedback.marks,
      [...pool, ...((missing ?? []) as unknown as Contact[])]
    );
    const suggestions = await loadTypeSuggestions(
      ctx.supabase,
      ctx.accountId,
      results
        .filter(({ details }) => details.type === 'unknown')
        .map(({ contact }) => contact.id)
    );
    const suggestedTypeFor = (contact: Contact, type: string) =>
      type === 'unknown' ? (suggestions[contact.id] ?? null) : null;

    // What each matched contact has already asked about, so a row can
    // say whether this share continues a conversation or opens one.
    const inquiriesByContact = await fetchInquiredProperties(
      ctx.supabase,
      ctx.accountId,
      results.map(({ contact }) => contact.id),
      3,
      propertyId
    );

    return NextResponse.json({
      data: results.map(({ contact, score, details, matchedFields }) => {
        // The notes only exist to feed the text heuristics; a client
        // rendering a match row has no use for free-form history.
        const row = { ...contact } as Contact & { contact_notes?: unknown };
        delete row.contact_notes;
        return {
          contact: row,
          score,
          details,
          matchedFields,
          sharedAt: sharedAtByContact.get(contact.id) ?? null,
          inquiries: inquiriesByContact.get(contact.id) ?? [],
          suggestedType: suggestedTypeFor(contact, details.type),
        };
      }),
      hidden: hidden.map(({ contact, feedback: mark }) => ({
        contact: {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          classification: contact.classification,
          name_tag: contact.name_tag,
        },
        feedback: mark,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

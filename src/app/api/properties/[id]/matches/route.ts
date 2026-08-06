import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getMatchingContacts } from '@/lib/matching';
import type { Contact, Property } from '@/types';

// Only the columns src/lib/matching.ts reads, plus what the caller needs
// to render and message a row — the same shape the web inventory fetches
// for its per-card match counts.
const MATCH_CONTACT_COLUMNS =
  'id, name, phone, classification, name_tag, requirements, requirement_active, ' +
  'min_budget, max_budget, no_budget, min_roi, property_interests, areas_of_interest, ' +
  'areas_of_interest_geo, projects_of_interest, strict_project_match, strict_area_match, ' +
  'pref_property_types, pref_property_categories, pref_bhk_min, pref_bhk_max, ' +
  'pref_budget_min, pref_budget_max, pref_areas, pref_excluded_areas, pref_projects, ' +
  'pref_min_roi, pref_listing_types, pref_extracted_at, contact_notes(note_text)';

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

    const results = getMatchingContacts(
      property as Property,
      (contacts ?? []) as unknown as Contact[]
    );

    return NextResponse.json({
      data: results.map(({ contact, score, details, matchedFields }) => {
        // The notes only exist to feed the text heuristics; a client
        // rendering a match row has no use for free-form history.
        const row = { ...contact } as Contact & { contact_notes?: unknown };
        delete row.contact_notes;
        return { contact: row, score, details, matchedFields };
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

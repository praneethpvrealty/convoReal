import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  requireRole,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { loadListingMatchFeedback } from '@/lib/inventory/match-feedback-store';
import {
  isMatchRejectReason,
  propertyTypeNote,
  propertyTypeOption,
  propertyTypePatch,
} from '@/lib/match-feedback';
import { getMatchingContacts } from '@/lib/matching';
import {
  activeRequirementProfiles,
  contactForRequirementProfile,
} from '@/lib/requirements/profiles';
import type { Contact, ContactRequirementProfile, Property } from '@/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

async function findListingAndContact(
  db: SupabaseClient,
  accountId: string,
  propertyId: string,
  contactId: string
) {
  const [{ data: property }, { data: contact }] = await Promise.all([
    db
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle(),
  ]);
  return { property, contact };
}

/**
 * Writes a staff type answer to the contact: the columns the matcher
 * reads, and the briefs it reads in their place. A brief that names no
 * type takes the answer; so does a brief that put the contact on this
 * listing, because the matcher reads a contact's first brief instead of
 * their own columns and would otherwise keep offering what the agent
 * just ruled out. A brief for something else is left alone: a buyer can
 * want a plot and, separately, a warehouse. The note in the agent's name
 * is what keeps the answer through a later re-extraction, which rebuilds
 * pref_* from requirements and notes, so a failed note fails the save.
 */
async function applyPropertyType(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contact: Contact,
  property: Partial<Property>,
  optionIds: string[]
): Promise<boolean> {
  const patch = propertyTypePatch(optionIds);
  const note = propertyTypeNote(optionIds);
  if (!patch || !note) return false;

  const profiles = Array.isArray(contact.requirement_profiles)
    ? (contact.requirement_profiles as ContactRequirementProfile[])
    : [];
  const matchedHere = new Set(
    activeRequirementProfiles(contact)
      .filter(
        (profile) =>
          getMatchingContacts(property, [
            contactForRequirementProfile(contact, profile),
          ]).length > 0
      )
      .map((profile) => profile.id)
  );
  const filledProfiles = profiles.map((profile) =>
    profile?.active !== false &&
    (matchedHere.has(profile.id) ||
      (!(profile.property_types ?? []).length &&
        !(profile.property_categories ?? []).length))
      ? {
          ...profile,
          property_types: patch.pref_property_types,
          property_categories: patch.pref_property_categories,
        }
      : profile
  );

  const { data: updated, error } = await db
    .from('contacts')
    .update({
      ...patch,
      ...(profiles.length ? { requirement_profiles: filledProfiles } : {}),
    })
    .eq('id', contact.id)
    .eq('account_id', accountId)
    .select('id');
  if (error || !updated?.length) {
    console.error('[match-feedback] contact type update failed:', error);
    return false;
  }

  const { error: noteError } = await db.from('contact_notes').insert({
    account_id: accountId,
    contact_id: contact.id,
    user_id: userId,
    note_text: note,
  });
  if (noteError) {
    console.error('[match-feedback] type note failed:', noteError);
    return false;
  }
  return true;
}

function readOptionIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.filter((v): v is string => typeof v === 'string');
  if (ids.length !== value.length || ids.some((id) => !propertyTypeOption(id)))
    return null;
  return [...new Set(ids)];
}

// GET /api/properties/[id]/match-feedback
// The "Not a fit" marks on this listing's matches, and a type suggestion
// for each contact the marks have taught something about.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: propertyId } = await params;
    if (!UUID_RE.test(propertyId)) return bad('Invalid property id');
    return NextResponse.json({
      data: await loadListingMatchFeedback(
        ctx.supabase,
        ctx.accountId,
        propertyId
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/properties/[id]/match-feedback
// { action: 'reject', contactId, reason, propertyTypes? }
//   marks the contact not a fit for this listing; with reason 'type',
//   propertyTypes (PROPERTY_TYPE_OPTIONS ids) also says what they want.
// { action: 'set_type', contactId, propertyTypes }
//   confirms a suggested type without marking anything.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: propertyId } = await params;
    if (!UUID_RE.test(propertyId)) return bad('Invalid property id');

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid body');
    const { action, contactId, reason } = body as Record<string, unknown>;
    if (typeof contactId !== 'string' || !UUID_RE.test(contactId))
      return bad('Invalid contact id');
    const optionIds = readOptionIds(
      (body as Record<string, unknown>).propertyTypes
    );
    if (optionIds === null) return bad('Unknown property type');

    if (action === 'reject') {
      if (!isMatchRejectReason(reason)) return bad('Unknown reason');
      if (optionIds.length && reason !== 'type')
        return bad('A property type goes with the wrong-type reason only');
    } else if (action === 'set_type') {
      if (!optionIds.length) return bad('Pick a property type');
    } else {
      return bad('Unknown action');
    }

    const { property, contact } = await findListingAndContact(
      ctx.supabase,
      ctx.accountId,
      propertyId,
      contactId
    );
    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // The buyer's own answer is never overwritten: a "no" they gave is
    // already a rejection that hides them and closes their enquiry, and
    // a "yes" is theirs to take back, not the agent's.
    const { data: existing, error: existingError } =
      action === 'reject'
        ? await ctx.supabase
            .from('listing_feedback')
            .select('verdict, source')
            .eq('account_id', ctx.accountId)
            .eq('property_id', propertyId)
            .eq('contact_id', contactId)
            .maybeSingle()
        : { data: null, error: null };
    if (existingError) {
      console.error(
        '[POST /api/properties/[id]/match-feedback]',
        existingError
      );
      return NextResponse.json(
        { error: 'Failed to save the mark' },
        { status: 500 }
      );
    }
    const buyerSaid = existing?.source === 'contact' ? existing.verdict : null;
    if (buyerSaid === 'interested') {
      return NextResponse.json(
        {
          error:
            'This contact told us they are interested in this listing, so it cannot be marked not a fit.',
          code: 'CONTACT_INTERESTED',
        },
        { status: 409 }
      );
    }

    if (action === 'reject' && buyerSaid !== 'rejected') {
      const { error } = await ctx.supabase.from('listing_feedback').upsert(
        {
          account_id: ctx.accountId,
          contact_id: contactId,
          property_id: propertyId,
          verdict: 'rejected',
          reason,
          channel: 'app',
          source: 'agent',
          created_by: ctx.userId,
        },
        { onConflict: 'contact_id,property_id' }
      );
      if (error) {
        console.error('[POST /api/properties/[id]/match-feedback]', error);
        return NextResponse.json(
          { error: 'Failed to save the mark' },
          { status: 500 }
        );
      }
    }

    const typeSaved = optionIds.length
      ? await applyPropertyType(
          ctx.supabase,
          ctx.accountId,
          ctx.userId,
          contact as Contact,
          property as Partial<Property>,
          optionIds
        )
      : false;
    if (optionIds.length && !typeSaved) {
      return NextResponse.json(
        {
          error:
            action === 'reject'
              ? 'Marked not a fit, but the property type could not be saved. Try again.'
              : 'Failed to save the property type',
          code: 'TYPE_NOT_SAVED',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { typeSaved } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/properties/[id]/match-feedback?contactId=
// Undoes an agent's mark, so the contact is offered for this listing
// again. The buyer's own "no" is theirs and stays.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWriteRole('agent');
    const { id: propertyId } = await params;
    const contactId = new URL(request.url).searchParams.get('contactId');
    if (!UUID_RE.test(propertyId)) return bad('Invalid property id');
    if (!contactId || !UUID_RE.test(contactId))
      return bad('Invalid contact id');

    const { data: removed, error } = await ctx.supabase
      .from('listing_feedback')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('property_id', propertyId)
      .eq('contact_id', contactId)
      .eq('verdict', 'rejected')
      .eq('source', 'agent')
      .select('id');
    if (!error && !removed?.length) {
      return NextResponse.json(
        { error: 'No agent mark to undo for this contact' },
        { status: 404 }
      );
    }
    if (error) {
      console.error('[DELETE /api/properties/[id]/match-feedback]', error);
      return NextResponse.json(
        { error: 'Failed to restore the contact' },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: { restored: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

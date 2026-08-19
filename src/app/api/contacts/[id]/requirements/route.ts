import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  buildPreferenceSourceText,
  extractContactPreferences,
  preferenceSourceHash,
} from '@/lib/ai/preference-extraction';
import {
  createRequirementProfile,
  hasStructuredRequirement,
  reviseRequirementProfile,
} from '@/lib/requirements/profiles';
import {
  generateMatchEventForContact,
  radarAdminClient,
  rankPropertiesForContact,
} from '@/lib/radar/engine';
import type { ContactRequirementProfile } from '@/types';

const MAX_TEXT_LENGTH = 4_000;
const MAX_PROFILES = 20;

async function refreshMatches(accountId: string, contactId: string) {
  const db = radarAdminClient();
  const matches = await rankPropertiesForContact(db, accountId, contactId);
  await generateMatchEventForContact(db, accountId, contactId);
  return matches.length;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const body = (await request.json().catch(() => null)) as {
      text?: unknown;
      source?: unknown;
    } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const source = body?.source === 'manual' ? 'manual' : 'personal_whatsapp';

    if (!text) {
      return NextResponse.json(
        { error: 'Requirement text is required.' },
        { status: 400 }
      );
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `Requirement text must be ${MAX_TEXT_LENGTH.toLocaleString()} characters or fewer.`,
        },
        { status: 400 }
      );
    }

    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select(
        'id, classification, requirement_profiles, buyer_alerts_consent, updated_at'
      )
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found.' },
        { status: 404 }
      );
    }
    if (!['Buyer', 'Owner & Buyer'].includes(contact.classification || '')) {
      return NextResponse.json(
        {
          error: 'Additional requirements can only be added to buyer contacts.',
        },
        { status: 400 }
      );
    }

    const existing = (
      Array.isArray(contact.requirement_profiles)
        ? contact.requirement_profiles
        : []
    ) as ContactRequirementProfile[];
    const duplicate = existing.find(
      (profile) => profile.raw_text.trim().toLowerCase() === text.toLowerCase()
    );
    if (duplicate) {
      const matchCount = await refreshMatches(ctx.accountId, contactId);
      return NextResponse.json({
        data: {
          profile: duplicate,
          duplicate: true,
          match_count: matchCount,
          alerts_active: contact.buyer_alerts_consent === 'granted',
        },
      });
    }
    if (existing.length >= MAX_PROFILES) {
      return NextResponse.json(
        {
          error: `This contact already has ${MAX_PROFILES} saved requirement profiles.`,
        },
        { status: 400 }
      );
    }

    const preferences = await extractContactPreferences(text);
    if (!hasStructuredRequirement(preferences)) {
      return NextResponse.json(
        {
          error:
            'I could not identify an area, property type, size, budget, project, or deal type. Add a little more detail and try again.',
        },
        { status: 422 }
      );
    }

    const profile = createRequirementProfile({
      id: crypto.randomUUID(),
      rawText: text,
      source,
      preferences,
    });
    const { data: saved, error: saveError } = await ctx.supabase
      .from('contacts')
      .update({
        requirement_profiles: [profile, ...existing],
        requirement_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .eq('updated_at', contact.updated_at)
      .select('id')
      .maybeSingle();
    if (saveError) throw saveError;
    if (!saved) {
      return NextResponse.json(
        {
          error:
            'The contact changed while this requirement was being saved. Please try again.',
        },
        { status: 409 }
      );
    }

    const matchCount = await refreshMatches(ctx.accountId, contactId);

    return NextResponse.json({
      data: {
        profile,
        duplicate: false,
        match_count: matchCount,
        alerts_active: contact.buyer_alerts_consent === 'granted',
      },
    });
  } catch (error) {
    console.error('[POST /api/contacts/[id]/requirements]', error);
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const body = (await request.json().catch(() => null)) as {
      target?: unknown;
      profile_id?: unknown;
      text?: unknown;
    } | null;
    const target = body?.target === 'profile' ? 'profile' : 'primary';
    const profileId =
      typeof body?.profile_id === 'string' ? body.profile_id : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';

    if (!text) {
      return NextResponse.json(
        { error: 'Requirement text is required.' },
        { status: 400 }
      );
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `Requirement text must be ${MAX_TEXT_LENGTH.toLocaleString()} characters or fewer.`,
        },
        { status: 400 }
      );
    }
    if (target === 'profile' && !profileId) {
      return NextResponse.json(
        { error: 'Requirement profile is required.' },
        { status: 400 }
      );
    }

    const { data: contact, error: contactError } = await ctx.supabase
      .from('contacts')
      .select(
        'id, classification, requirement_profiles, buyer_alerts_consent, updated_at, contact_notes (note_text)'
      )
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found.' },
        { status: 404 }
      );
    }
    if (!['Buyer', 'Owner & Buyer'].includes(contact.classification || '')) {
      return NextResponse.json(
        { error: 'Requirements can only be edited for buyer contacts.' },
        { status: 400 }
      );
    }

    const existingProfiles = (
      Array.isArray(contact.requirement_profiles)
        ? contact.requirement_profiles
        : []
    ) as ContactRequirementProfile[];
    let savedProfile: ContactRequirementProfile | null = null;
    let update: Record<string, unknown>;

    if (target === 'profile') {
      const existingProfile = existingProfiles.find(
        (profile) => profile.id === profileId
      );
      if (!existingProfile) {
        return NextResponse.json(
          { error: 'Requirement profile not found.' },
          { status: 404 }
        );
      }

      const preferences = await extractContactPreferences(text);
      if (!hasStructuredRequirement(preferences)) {
        return NextResponse.json(
          {
            error:
              'I could not identify an area, property type, size, budget, project, or deal type. Add a little more detail and try again.',
          },
          { status: 422 }
        );
      }
      savedProfile = reviseRequirementProfile({
        profile: existingProfile,
        rawText: text,
        preferences,
      });
      update = {
        requirement_profiles: existingProfiles.map((profile) =>
          profile.id === profileId ? savedProfile : profile
        ),
        requirement_active: true,
        updated_at: new Date().toISOString(),
      };
    } else {
      const sourceText = buildPreferenceSourceText(
        text,
        contact.contact_notes || []
      );
      const preferences = await extractContactPreferences(sourceText);
      if (!hasStructuredRequirement(preferences)) {
        return NextResponse.json(
          {
            error:
              'I could not identify an area, property type, size, budget, project, or deal type. Add a little more detail and try again.',
          },
          { status: 422 }
        );
      }
      update = {
        requirements: text,
        pref_property_types: preferences.property_types,
        pref_property_categories: preferences.property_categories,
        pref_bhk_min: preferences.bhk_min,
        pref_bhk_max: preferences.bhk_max,
        pref_budget_min: preferences.budget_min,
        pref_budget_max: preferences.budget_max,
        pref_land_area_min_sqft: preferences.land_area_min_sqft,
        pref_land_area_max_sqft: preferences.land_area_max_sqft,
        pref_areas: preferences.areas,
        pref_excluded_areas: preferences.excluded_areas,
        pref_projects: preferences.projects,
        pref_suggested_tags: preferences.suggested_tags,
        pref_min_roi: preferences.min_roi,
        pref_listing_types: preferences.listing_types,
        pref_source_hash: preferenceSourceHash(sourceText),
        pref_extracted_at: new Date().toISOString(),
        requirement_active: true,
        updated_at: new Date().toISOString(),
      };
    }

    const { data: saved, error: saveError } = await ctx.supabase
      .from('contacts')
      .update(update)
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .eq('updated_at', contact.updated_at)
      .select('id')
      .maybeSingle();
    if (saveError) throw saveError;
    if (!saved) {
      return NextResponse.json(
        {
          error:
            'The contact changed while this requirement was being saved. Please reopen Requirements and try again.',
        },
        { status: 409 }
      );
    }

    const matchCount = await refreshMatches(ctx.accountId, contactId);
    return NextResponse.json({
      data: {
        profile: savedProfile,
        match_count: matchCount,
        alerts_active: contact.buyer_alerts_consent === 'granted',
      },
    });
  } catch (error) {
    console.error('[PATCH /api/contacts/[id]/requirements]', error);
    return toErrorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { extractContactPreferences } from '@/lib/ai/preference-extraction';
import {
  createRequirementProfile,
  hasStructuredRequirement,
} from '@/lib/requirements/profiles';
import {
  generateMatchEventForContact,
  radarAdminClient,
  rankPropertiesForContact,
} from '@/lib/radar/engine';
import type { ContactRequirementProfile } from '@/types';

const MAX_TEXT_LENGTH = 4_000;
const MAX_PROFILES = 20;

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
      const matches = await rankPropertiesForContact(
        radarAdminClient(),
        ctx.accountId,
        contactId
      );
      return NextResponse.json({
        data: {
          profile: duplicate,
          duplicate: true,
          match_count: matches.length,
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

    const db = radarAdminClient();
    const matches = await rankPropertiesForContact(
      db,
      ctx.accountId,
      contactId
    );
    await generateMatchEventForContact(db, ctx.accountId, contactId);

    return NextResponse.json({
      data: {
        profile,
        duplicate: false,
        match_count: matches.length,
        alerts_active: contact.buyer_alerts_consent === 'granted',
      },
    });
  } catch (error) {
    console.error('[POST /api/contacts/[id]/requirements]', error);
    return toErrorResponse(error);
  }
}

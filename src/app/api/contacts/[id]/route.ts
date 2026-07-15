import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeAreasGeo } from '@/lib/contacts/area-geo';

// PUT /api/contacts/[id] — update a contact with tags, notes, and property links
// in a single server-side call (replaces multi-step client writes in contact-form.tsx).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const limit = checkRateLimit(
      `agent:updateContact:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      name, name_tag, phone, secondary_phones, email, company, classification, lead_temp,
      last_inquired_property_id, referrer, referrer_contact_id,
      min_budget, max_budget, no_budget, areas_of_interest, areas_of_interest_geo,
      property_interests, min_roi, source, dob, feedback_status,
      strict_area_match,
      // Related entities
      tag_ids,
      note_text,
      recent_note_id,
      property_ids,
    } = body;

    // Validation
    if (typeof phone !== 'string' || phone.trim().length === 0) {
      return NextResponse.json(
        { error: "'phone' is required" },
        { status: 400 },
      );
    }

    const fieldsToSave = {
      name: typeof name === 'string' ? name.trim() || null : null,
      name_tag: typeof name_tag === 'string' ? name_tag.trim() || null : null,
      phone: phone.trim(),
      secondary_phones: Array.isArray(secondary_phones)
        ? secondary_phones.filter((p: unknown) => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
        : [],
      email: typeof email === 'string' ? email.trim() || null : null,
      company: typeof company === 'string' ? company.trim() || null : null,
      classification: typeof classification === 'string' ? classification : 'Buyer',
      lead_temp: typeof lead_temp === 'string' ? lead_temp || null : null,
      last_inquired_property_id: typeof last_inquired_property_id === 'string' ? last_inquired_property_id || null : null,
      referrer: typeof referrer === 'string' ? referrer.trim() || null : null,
      referrer_contact_id: typeof referrer_contact_id === 'string' ? referrer_contact_id || null : null,
      min_budget: typeof min_budget === 'number' ? min_budget : null,
      max_budget: typeof max_budget === 'number' ? max_budget : null,
      no_budget: typeof no_budget === 'boolean' ? no_budget : false,
      areas_of_interest: Array.isArray(areas_of_interest) ? areas_of_interest : [],
      areas_of_interest_geo: sanitizeAreasGeo(areas_of_interest_geo),
      property_interests: Array.isArray(property_interests) ? property_interests : [],
      min_roi: typeof min_roi === 'number' ? min_roi : null,
      source: typeof source === 'string' ? source.trim() || null : null,
      dob: typeof dob === 'string' && dob.trim() ? dob.trim() : null,
      feedback_status: typeof feedback_status === 'string' ? feedback_status : 'not_requested',
      strict_area_match: typeof strict_area_match === 'boolean' ? strict_area_match : false,
      updated_at: new Date().toISOString(),
    };

    // Step 1: Update the contact row
    const { error: updateErr } = await ctx.supabase
      .from('contacts')
      .update(fieldsToSave)
      .eq('id', contactId);

    if (updateErr) {
      console.error('[PUT /api/contacts/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update contact' },
        { status: 500 },
      );
    }

    // Step 2: Sync tags — delete old, insert new
    await ctx.supabase
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId);

    const tagIds = Array.isArray(tag_ids) ? tag_ids.filter((id: unknown) => typeof id === 'string') : [];
    if (tagIds.length > 0) {
      const tagRows = tagIds.map((tag_id: string) => ({
        contact_id: contactId,
        tag_id,
      }));
      const { error: tagErr } = await ctx.supabase
        .from('contact_tags')
        .insert(tagRows);
      if (tagErr) {
        console.error('[PUT /api/contacts/[id]] Tag sync error:', tagErr);
      }
    }

    // Step 3: Upsert/delete note
    const noteStr = typeof note_text === 'string' ? note_text.trim() : '';
    const noteId = typeof recent_note_id === 'string' ? recent_note_id : null;

    if (noteId) {
      if (noteStr) {
        const { error: noteErr } = await ctx.supabase
          .from('contact_notes')
          .update({ note_text: noteStr })
          .eq('id', noteId);
        if (noteErr) {
          console.error('[PUT /api/contacts/[id]] Note update error:', noteErr);
        }
      } else {
        await ctx.supabase
          .from('contact_notes')
          .delete()
          .eq('id', noteId);
      }
    } else if (noteStr) {
      const { error: noteErr } = await ctx.supabase
        .from('contact_notes')
        .insert({
          contact_id: contactId,
          user_id: ctx.userId,
          account_id: ctx.accountId,
          note_text: noteStr,
        });
      if (noteErr) {
        console.error('[PUT /api/contacts/[id]] Note insert error:', noteErr);
      }
    }

    // Step 4: Sync properties (owner_contact_id)
    const cls = typeof classification === 'string' ? classification : '';
    if (['Buyer', 'Seller', 'Agent', 'Developer', 'Owner', 'Owner & Buyer'].includes(cls)) {
      // Clear existing ownership links for this contact
      await ctx.supabase
        .from('properties')
        .update({ owner_contact_id: null })
        .eq('owner_contact_id', contactId);

      const propIds = Array.isArray(property_ids) ? property_ids.filter((id: unknown) => typeof id === 'string') : [];
      if (propIds.length > 0) {
        const { error: propErr } = await ctx.supabase
          .from('properties')
          .update({ owner_contact_id: contactId })
          .in('id', propIds);
        if (propErr) {
          console.error('[PUT /api/contacts/[id]] Property link error:', propErr);
        }
      }
    }

    // Fire-and-forget: extract AI matching preferences
    fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/contacts/extract-preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId] }),
    }).catch(() => {});

    return NextResponse.json({ id: contactId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

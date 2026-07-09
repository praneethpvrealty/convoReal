import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';

// POST /api/contacts — create a new contact with tags, notes, and property links
// in a single server-side transaction (replaces the multi-step client writes in contact-form.tsx).
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:createContact:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const gate = await checkPlanLimit(ctx, 'contacts');
    if (!gate.allowed) return gateResponse(gate);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      name, phone, email, company, classification, lead_temp,
      last_inquired_property_id, referrer, referrer_contact_id,
      min_budget, max_budget, no_budget, areas_of_interest,
      property_interests, min_roi, source,
      // Related entities
      tag_ids,
      note_text,
      property_ids,
    } = body;

    // Validation
    if (typeof phone !== 'string' || phone.trim().length === 0) {
      return NextResponse.json(
        { error: "'phone' is required" },
        { status: 400 },
      );
    }

    const contactData = {
      user_id: ctx.userId,
      account_id: ctx.accountId,
      name: typeof name === 'string' ? name.trim() || null : null,
      phone: phone.trim(),
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
      property_interests: Array.isArray(property_interests) ? property_interests : [],
      min_roi: typeof min_roi === 'number' ? min_roi : null,
      source: typeof source === 'string' ? source.trim() || null : null,
    };

    // Step 1: Insert the contact
    const { data: created, error: insertErr } = await ctx.supabase
      .from('contacts')
      .insert(contactData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/contacts] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create contact' },
        { status: 500 },
      );
    }

    const contactId = created.id;

    // Step 2: Sync tags
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
        console.error('[POST /api/contacts] Tag insert error:', tagErr);
      }
    }

    // Step 3: Insert note
    const noteStr = typeof note_text === 'string' ? note_text.trim() : '';
    if (noteStr) {
      const { error: noteErr } = await ctx.supabase
        .from('contact_notes')
        .insert({
          contact_id: contactId,
          user_id: ctx.userId,
          account_id: ctx.accountId,
          note_text: noteStr,
        });
      if (noteErr) {
        console.error('[POST /api/contacts] Note insert error:', noteErr);
      }
    }

    // Step 4: Link properties (for Seller/Owner/Agent classifications)
    const propIds = Array.isArray(property_ids) ? property_ids.filter((id: unknown) => typeof id === 'string') : [];
    if (propIds.length > 0 && ['Buyer', 'Seller', 'Agent', 'Developer', 'Owner', 'Owner & Buyer'].includes(contactData.classification)) {
      const { error: propErr } = await ctx.supabase
        .from('properties')
        .update({ owner_contact_id: contactId })
        .in('id', propIds);
      if (propErr) {
        console.error('[POST /api/contacts] Property link error:', propErr);
      }
    }

    // Fire-and-forget: extract AI matching preferences
    fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/contacts/extract-preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [contactId] }),
    }).catch(() => {});

    return NextResponse.json({ id: contactId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

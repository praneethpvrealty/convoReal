import { NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { loadPartyForContact, type PartyKind } from '@/lib/contacts/parties';

// The party a contact buys with — a couple, or colleagues from one firm
// (migration 288). Deliberately NOT a merge: every member keeps their
// own contact row, number, consent and WhatsApp thread, and this route
// only ever writes the two join tables.

const KINDS: PartyKind[] = ['household', 'company', 'partners'];

/** GET — the caller's party, or null when they buy alone. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: contactId } = await params;
    const supabase = await createClient();
    const party = await loadPartyForContact(supabase, ctx.accountId, contactId);
    return NextResponse.json({ data: party });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST — link this contact with others into one party, creating it on
 * first link. Idempotent: re-posting the same members is a no-op.
 *
 * A contact belongs to at most one party (the UNIQUE in migration 288),
 * so linking someone who is already in a different party is refused
 * rather than silently moving them — that would quietly unlink them
 * from a deal somebody else is working.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const limit = await checkRateLimit(
      `agent:contactParty:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      contact_ids?: unknown;
      kind?: unknown;
      name?: unknown;
      primary_contact_id?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const others = Array.isArray(body.contact_ids)
      ? body.contact_ids.filter(
          (v): v is string => typeof v === 'string' && v.length > 0
        )
      : [];
    if (!others.length) {
      return NextResponse.json(
        { error: 'Pick at least one other contact to link.' },
        { status: 400 }
      );
    }
    const memberIds = [...new Set([contactId, ...others])];
    if (memberIds.includes('')) {
      return NextResponse.json({ error: 'Invalid contact' }, { status: 400 });
    }

    const kind: PartyKind = KINDS.includes(body.kind as PartyKind)
      ? (body.kind as PartyKind)
      : 'household';
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : null;
    const primaryContactId =
      typeof body.primary_contact_id === 'string' &&
      memberIds.includes(body.primary_contact_id)
        ? body.primary_contact_id
        : contactId;

    const supabase = await createClient();

    // Every member must be a real contact in this account. RLS would
    // block a foreign row anyway; checking here turns a silent partial
    // link into a clear refusal.
    const { data: found } = await supabase
      .from('contacts')
      .select('id')
      .eq('account_id', ctx.accountId)
      .in('id', memberIds);
    if ((found ?? []).length !== memberIds.length) {
      return NextResponse.json(
        { error: 'One of those contacts is not in this account.' },
        { status: 400 }
      );
    }

    const { data: existingRows } = await supabase
      .from('contact_party_members')
      .select('contact_id, party_id')
      .eq('account_id', ctx.accountId)
      .in('contact_id', memberIds);
    const existing = (existingRows ?? []) as {
      contact_id: string;
      party_id: string;
    }[];
    const partyIds = [...new Set(existing.map((r) => r.party_id))];
    if (partyIds.length > 1) {
      return NextResponse.json(
        {
          error:
            'Those contacts are already in different parties. Unlink one of them first.',
        },
        { status: 409 }
      );
    }

    let partyId = partyIds[0];
    if (!partyId) {
      const { data: created, error: createError } = await supabase
        .from('contact_parties')
        .insert({ account_id: ctx.accountId, kind, name })
        .select('id')
        .single();
      if (createError || !created) {
        return NextResponse.json(
          { error: createError?.message || 'Could not create the party.' },
          { status: 500 }
        );
      }
      partyId = (created as { id: string }).id;
    } else if (name || body.kind) {
      const { data: renamed, error: renameError } = await supabase
        .from('contact_parties')
        .update({ ...(name ? { name } : {}), ...(body.kind ? { kind } : {}) })
        .eq('id', partyId)
        .eq('account_id', ctx.accountId)
        .select('id');
      if (renameError || !renamed?.length) {
        return NextResponse.json(
          { error: renameError?.message || 'Could not update the party.' },
          { status: 500 }
        );
      }
    }

    const { error: memberError } = await supabase
      .from('contact_party_members')
      .upsert(
        memberIds.map((id) => ({
          account_id: ctx.accountId,
          party_id: partyId,
          contact_id: id,
          is_primary: false,
        })),
        { onConflict: 'account_id,contact_id' }
      );
    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    // Clear then set: the partial unique index in migration 288 rejects
    // two primaries, so the old one has to go first. Both halves are
    // checked — a party left with nobody to address would silently send
    // the next card to whichever row sorted first.
    const { error: clearError } = await supabase
      .from('contact_party_members')
      .update({ is_primary: false })
      .eq('account_id', ctx.accountId)
      .eq('party_id', partyId)
      .select('id');
    const { data: promoted, error: promoteError } = await supabase
      .from('contact_party_members')
      .update({ is_primary: true })
      .eq('account_id', ctx.accountId)
      .eq('party_id', partyId)
      .eq('contact_id', primaryContactId)
      .select('id');
    if (clearError || promoteError || !promoted?.length) {
      return NextResponse.json(
        {
          error:
            clearError?.message ||
            promoteError?.message ||
            'Linked, but could not set who we message. Try again.',
        },
        { status: 500 }
      );
    }

    const party = await loadPartyForContact(supabase, ctx.accountId, contactId);
    return NextResponse.json({ data: party });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE — take this contact out of their party. The party itself is
 * removed once fewer than two members remain: a party of one is just a
 * contact, and leaving it behind would keep the "buys with others"
 * badge on someone who no longer does.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const supabase = await createClient();

    const { data: mine } = await supabase
      .from('contact_party_members')
      .select('party_id, is_primary')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .maybeSingle();
    const row = mine as { party_id: string; is_primary: boolean } | null;
    if (!row) return NextResponse.json({ data: null });

    const { data: removed, error: removeError } = await supabase
      .from('contact_party_members')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .select('id');
    if (removeError || !removed?.length) {
      return NextResponse.json(
        { error: removeError?.message || 'Could not unlink that contact.' },
        { status: 500 }
      );
    }

    const { data: remaining } = await supabase
      .from('contact_party_members')
      .select('contact_id, is_primary')
      .eq('account_id', ctx.accountId)
      .eq('party_id', row.party_id);
    const left = (remaining ?? []) as {
      contact_id: string;
      is_primary: boolean;
    }[];

    if (left.length < 2) {
      const { error: dropError } = await supabase
        .from('contact_parties')
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('id', row.party_id)
        .select('id');
      if (dropError) {
        return NextResponse.json({ error: dropError.message }, { status: 500 });
      }
    } else if (row.is_primary) {
      // The party must keep someone to address, or the next card would
      // fall back to whichever row happened to sort first.
      const { data: newPrimary, error: promoteError } = await supabase
        .from('contact_party_members')
        .update({ is_primary: true })
        .eq('account_id', ctx.accountId)
        .eq('party_id', row.party_id)
        .eq('contact_id', left[0].contact_id)
        .select('id');
      if (promoteError || !newPrimary?.length) {
        return NextResponse.json(
          {
            error:
              promoteError?.message ||
              'Unlinked, but the party has nobody to message. Set one on the remaining contact.',
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ data: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

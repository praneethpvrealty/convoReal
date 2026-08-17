import { NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import {
  suggestPartyMembers,
  suggestionPairKey,
  type SuggestionCandidate,
} from '@/lib/contacts/party-suggestions';

// Who this contact might be buying with. Suggestions only — the link
// itself is always an explicit agent action through the party route
// next door, because a wrong link quietly merges two deals' follow-ups.

const MAX_SUGGESTIONS = 5;
/** Candidate pool ceiling. The signals are all equality checks, so this
 *  is about payload size rather than the comparison cost. */
const MAX_CANDIDATES = 500;

/** GET — ranked candidates, with the property titles resolved for the
 *  strongest signal so the agent reads a listing, not a uuid. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const supabase = await createClient();

    const [
      { data: contactRows },
      { data: itemRows },
      { data: linkedRows },
      { data: dismissedRows },
    ] = await Promise.all([
      supabase
        .from('contacts')
        .select('id, name, second_name, phone, email, company')
        .eq('account_id', ctx.accountId)
        .eq('is_merged', false)
        .limit(MAX_CANDIDATES),
      supabase
        .from('journey_items')
        .select('contact_id, property_id')
        .eq('account_id', ctx.accountId)
        .eq('status', 'active'),
      supabase
        .from('contact_party_members')
        .select('contact_id')
        .eq('account_id', ctx.accountId),
      supabase
        .from('party_suggestion_dismissals')
        .select('pair_key')
        .eq('account_id', ctx.accountId),
    ]);

    const propertiesByContact = new Map<string, string[]>();
    for (const item of (itemRows ?? []) as {
      contact_id: string;
      property_id: string;
    }[]) {
      const list = propertiesByContact.get(item.contact_id);
      if (list) list.push(item.property_id);
      else propertiesByContact.set(item.contact_id, [item.property_id]);
    }

    const candidates: SuggestionCandidate[] = (
      (contactRows ?? []) as SuggestionCandidate[]
    ).map((c) => ({ ...c, propertyIds: propertiesByContact.get(c.id) ?? [] }));

    const subject = candidates.find((c) => c.id === contactId);
    if (!subject) return NextResponse.json({ data: [] });

    const linked = new Set(
      ((linkedRows ?? []) as { contact_id: string }[]).map((r) => r.contact_id)
    );
    const dismissed = new Set(
      ((dismissedRows ?? []) as { pair_key: string }[]).map((r) => r.pair_key)
    );

    const suggestions = suggestPartyMembers(
      subject,
      candidates,
      linked,
      dismissed
    ).slice(0, MAX_SUGGESTIONS);

    // Resolve the property titles for same_property rows only — the
    // other reasons already carry human-readable evidence.
    const propertyIds = suggestions
      .filter((s) => s.reason === 'same_property')
      .map((s) => s.detail);
    if (propertyIds.length) {
      const { data: properties } = await supabase
        .from('properties')
        .select('id, title')
        .eq('account_id', ctx.accountId)
        .in('id', propertyIds);
      const titles = new Map(
        ((properties ?? []) as { id: string; title: string }[]).map((p) => [
          p.id,
          p.title,
        ])
      );
      for (const s of suggestions) {
        if (s.reason === 'same_property') {
          s.detail = titles.get(s.detail) ?? 'the same listing';
        }
      }
    }

    return NextResponse.json({ data: suggestions });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE — "not related", remembered so the pair is not re-offered. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const limit = await checkRateLimit(
      `agent:partySuggestion:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const other = request.nextUrl.searchParams.get('contact_id');
    if (!other) {
      return NextResponse.json(
        { error: 'contact_id is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('party_suggestion_dismissals')
      .upsert(
        {
          account_id: ctx.accountId,
          pair_key: suggestionPairKey(contactId, other),
          dismissed_by: ctx.userId,
        },
        { onConflict: 'account_id,pair_key' }
      )
      .select('id');
    if (error || !data?.length) {
      return NextResponse.json(
        { error: error?.message || 'Could not dismiss that suggestion.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

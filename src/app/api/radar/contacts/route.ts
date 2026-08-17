import { NextRequest, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadEligibleRadarContacts } from '@/lib/radar/manual-contacts';
import type { MatchEvent } from '@/types';

// GET /api/radar/contacts?eventId=<uuid>&q=<search>
// Searches existing eligible Buyers/Agents for a new-property event and
// omits contacts already suggested by the matching engine.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('agent');
    const eventId = request.nextUrl.searchParams.get('eventId')?.trim();
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';

    if (!eventId) {
      return NextResponse.json(
        { error: 'eventId is required' },
        { status: 400 }
      );
    }
    if (query.length < 2) return NextResponse.json({ data: [] });

    const { data: event, error } = await ctx.supabase
      .from('match_events')
      .select('id, kind, matches, source')
      .eq('id', eventId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const typedEvent = event as Pick<
      MatchEvent,
      'id' | 'kind' | 'matches' | 'source'
    >;
    if (
      typedEvent.kind !== 'new_property' ||
      typedEvent.source === 'deal_mode'
    ) {
      return NextResponse.json(
        { error: 'Contacts can only be added to new listing alerts' },
        { status: 400 }
      );
    }

    const matchedIds = new Set(typedEvent.matches.map((match) => match.id));
    const contacts = await loadEligibleRadarContacts(
      ctx.supabase,
      ctx.accountId,
      {
        query,
        limit: 16,
      }
    );

    return NextResponse.json({
      data: contacts
        .filter((contact) => !matchedIds.has(contact.id))
        .slice(0, 12),
    });
  } catch (err) {
    console.error('[GET /api/radar/contacts] Unexpected error:', err);
    return toErrorResponse(err);
  }
}

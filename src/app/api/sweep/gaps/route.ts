import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/**
 * The gaps the daily sweep raised, for the review screen and the
 * mobile app.
 *
 * Read-only and account-scoped through the SSR client, so RLS is
 * doing the isolation here rather than hand-written filters — this is
 * a staff surface, not one of the service-role personas in §8.3.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const url = new URL(request.url);

    const status = url.searchParams.get('status') || 'open';
    if (!['open', 'resolved', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const contactId = url.searchParams.get('contactId');

    let query = supabase
      .from('conversation_gaps')
      .select(
        'id, kind, severity, summary, evidence, suggested_action, occurred_at, occurrence_count, channel, status, contact_id, conversation_id, property_id, contacts(id, name)'
      )
      .eq('account_id', accountId)
      .eq('status', status)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (contactId) query = query.eq('contact_id', contactId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  CALL_BACK_EVENT_TYPE,
  CALL_BACK_LIMIT,
  callBackLookbackStart,
} from '@/lib/calendar/call-backs';

export async function GET() {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const { data, error } = await supabase
      .from('appointments')
      .select(
        'id, title, start_time, end_time, status, event_type, contact_id, agenda, contact:contacts(id, name, phone, name_tag)'
      )
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .eq('event_type', CALL_BACK_EVENT_TYPE)
      .eq('status', 'scheduled')
      .gte('start_time', callBackLookbackStart(new Date()))
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
      .limit(CALL_BACK_LIMIT);

    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

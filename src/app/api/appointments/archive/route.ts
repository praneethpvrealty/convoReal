import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { ARCHIVE_BATCH_LIMIT } from '@/lib/calendar/tasks-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const body = await request.json().catch(() => null);
    const archived = body?.archived;
    const ids: unknown = body?.ids;
    if (typeof archived !== 'boolean' || !Array.isArray(ids)) {
      return NextResponse.json(
        { error: 'Send ids (an array) and archived (true or false)' },
        { status: 400 }
      );
    }
    const unique = [...new Set(ids)];
    if (unique.length === 0 || unique.length > ARCHIVE_BATCH_LIMIT) {
      return NextResponse.json(
        { error: `Send between 1 and ${ARCHIVE_BATCH_LIMIT} events` },
        { status: 400 }
      );
    }
    if (
      !unique.every(
        (id): id is string => typeof id === 'string' && UUID.test(id)
      )
    ) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    }

    const archivedAt = archived ? new Date().toISOString() : null;
    const changed: string[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const { data, error } = archived
        ? await supabase
            .from('appointments')
            .update({ archived_at: archivedAt })
            .eq('account_id', accountId)
            .in('id', chunk)
            .neq('status', 'scheduled')
            .select('id')
        : await supabase
            .from('appointments')
            .update({ archived_at: null })
            .eq('account_id', accountId)
            .in('id', chunk)
            .select('id');
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      for (const row of data ?? []) changed.push(row.id);
    }

    return NextResponse.json({
      data: { ids: changed, archived_at: archivedAt },
    });
  } catch (error) {
    console.error('Error archiving appointments:', error);
    return toErrorResponse(error);
  }
}

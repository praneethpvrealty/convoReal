import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseStageNoteInput } from '@/lib/journey/stage-notes';

export async function POST(request: Request) {
  let accountId: string;
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];

  try {
    ({ accountId, supabase } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  const parsed = parseStageNoteInput(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { itemId, note } = parsed.value;

  const { data: saved, error } = await supabase
    .rpc('add_journey_item_note', {
      p_account_id: accountId,
      p_item_id: itemId,
      p_note: note,
    })
    .select(
      'id, account_id, item_id, stage_id, stage_name, stage_color, note, created_by, created_by_name, created_at'
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to save the note' },
      { status: 500 }
    );
  }
  if (!saved) {
    return NextResponse.json(
      { error: 'Journey item not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: saved });
}

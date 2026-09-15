import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseStageNoteInput } from '@/lib/journey/stage-notes';

export async function POST(request: Request) {
  let accountId: string;
  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];

  try {
    ({ accountId, userId, supabase } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  const parsed = parseStageNoteInput(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { itemId, stageId, note } = parsed.value;

  const { data: item, error } = await supabase
    .from('journey_items')
    .select('id')
    .eq('id', itemId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load journey item' },
      { status: 500 }
    );
  }
  if (!item) {
    return NextResponse.json(
      { error: 'Journey item not found' },
      { status: 404 }
    );
  }

  const { data: stage } = await supabase
    .from('journey_stages')
    .select('id')
    .eq('id', stageId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!stage) {
    return NextResponse.json(
      { error: 'Journey stage not found' },
      { status: 404 }
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();

  const { data: saved, error: saveError } = await supabase
    .from('journey_stage_notes')
    .insert({
      account_id: accountId,
      item_id: itemId,
      stage_id: stageId,
      note,
      created_by: userId,
      created_by_name: profile?.full_name || null,
    })
    .select(
      'id, account_id, item_id, stage_id, note, created_by, created_by_name, created_at'
    )
    .single();

  if (saveError) {
    return NextResponse.json(
      { error: 'Failed to add stage note' },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: saved });
}

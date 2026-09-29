import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  journeyCompartmentOwner,
  journeyCompartmentScopeOf,
  parseJourneyCompartmentMutation,
} from '@/lib/journey/compartments';
import { ownedJourneySubjects } from '@/lib/journey/owned-subjects';

type RouteSupabase = Awaited<ReturnType<typeof requireRole>>['supabase'];

async function accountScope(supabase: RouteSupabase, accountId: string) {
  const { data, error } = await supabase
    .from('accounts')
    .select('journey_compartment_scope')
    .eq('id', accountId)
    .single();
  if (error) throw error;
  return journeyCompartmentScopeOf(data?.journey_compartment_scope);
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('viewer');
    const mode = new URL(request.url).searchParams.get('mode');
    if (mode !== 'buyer' && mode !== 'property') {
      return NextResponse.json(
        { error: 'Invalid journey mode' },
        { status: 400 }
      );
    }
    const scope = await accountScope(supabase, accountId);
    const owner = journeyCompartmentOwner(scope, userId);
    let query = supabase
      .from('journey_compartments')
      .select('subject_id')
      .eq('account_id', accountId)
      .eq('mode', mode)
      .eq('compartment', 'focus');
    query = owner ? query.eq('user_id', owner) : query.is('user_id', null);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({
      data: {
        scope,
        focus: (data ?? []).map((row) => row.subject_id as string),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let accountId: string;
  let userId: string;
  let supabase: RouteSupabase;
  try {
    ({ supabase, accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  const parsed = parseJourneyCompartmentMutation(
    await request.json().catch(() => null)
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { mode, subjectId, compartment } = parsed.value;
    if (!(await ownedJourneySubjects(supabase, accountId, mode, [subjectId]))) {
      return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
    }
    const scope = await accountScope(supabase, accountId);
    const { error } = await supabase.from('journey_compartments').upsert(
      {
        account_id: accountId,
        mode,
        subject_id: subjectId,
        user_id: journeyCompartmentOwner(scope, userId),
        compartment,
        created_by: userId,
      },
      { onConflict: 'account_id,mode,subject_id,user_id' }
    );
    if (error) throw error;
    return NextResponse.json({ data: { scope, subjectId, compartment } });
  } catch (error) {
    console.error('[journey/compartments] failed', error);
    return NextResponse.json(
      { error: 'Failed to move journey' },
      { status: 500 }
    );
  }
}

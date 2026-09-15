import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  parseJourneyStateMutation,
  type JourneyOverviewMode,
  type JourneyStateMutation,
} from '@/lib/journey/overview-state';

async function ownedSubjects(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  mode: JourneyOverviewMode,
  subjectIds: string[]
): Promise<boolean> {
  const column = mode === 'buyer' ? 'contact_id' : 'property_id';
  const { data, error } = await supabase
    .from('journey_items')
    .select(column)
    .eq('account_id', accountId)
    .in(column, subjectIds)
    .limit(2000);
  if (error) throw error;
  const found = new Set(
    (data ?? []).map(
      (row) => (row as unknown as Record<string, string>)[column]
    )
  );
  return subjectIds.every((id) => found.has(id));
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const mode = new URL(request.url).searchParams.get('mode');
    if (mode !== 'buyer' && mode !== 'property') {
      return NextResponse.json(
        { error: 'Invalid journey mode' },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from('journey_overview_states')
      .select(
        'subject_id, lifecycle_status, closure_reason, closed_at, archived_at, sort_order'
      )
      .eq('account_id', accountId)
      .eq('mode', mode);
    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let accountId: string;
  let userId: string;
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  try {
    ({ supabase, accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  const parsed = parseJourneyStateMutation(
    await request.json().catch(() => null)
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const mutation = parsed.value;
    const subjectIds =
      mutation.action === 'reorder'
        ? mutation.subjectIds
        : [mutation.subjectId];
    if (
      !(await ownedSubjects(supabase, accountId, mutation.mode, subjectIds))
    ) {
      return NextResponse.json(
        { error: 'One or more journeys were not found' },
        { status: 404 }
      );
    }

    const rows = rowsForMutation(mutation, accountId, userId);
    const { error } = await supabase
      .from('journey_overview_states')
      .upsert(rows, {
        onConflict: 'account_id,mode,subject_id',
      });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[journey/overview] failed', error);
    return NextResponse.json(
      { error: 'Failed to update journey' },
      { status: 500 }
    );
  }
}

function rowsForMutation(
  mutation: JourneyStateMutation,
  accountId: string,
  userId: string
): Record<string, unknown>[] {
  const base = {
    account_id: accountId,
    mode: mutation.mode,
    created_by: userId,
    updated_by: userId,
  };
  if (mutation.action === 'reorder') {
    return mutation.subjectIds.map((subjectId, sortOrder) => ({
      ...base,
      subject_id: subjectId,
      sort_order: sortOrder,
    }));
  }
  if (mutation.action === 'close') {
    return [
      {
        ...base,
        subject_id: mutation.subjectId,
        lifecycle_status: mutation.status,
        closure_reason: mutation.reason,
        closed_at: new Date().toISOString(),
      },
    ];
  }
  if (mutation.action === 'reopen') {
    return [
      {
        ...base,
        subject_id: mutation.subjectId,
        lifecycle_status: 'active',
        closure_reason: null,
        closed_at: null,
      },
    ];
  }
  return [
    {
      ...base,
      subject_id: mutation.subjectId,
      archived_at:
        mutation.action === 'archive' ? new Date().toISOString() : null,
    },
  ];
}

import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { CallDirection, CallOutcome } from '@/types';

// GET  /api/contacts/[id]/calls  — list call logs for a contact
// POST /api/contacts/[id]/calls  — create a call log

const VALID_DIRECTIONS = new Set<CallDirection>(['outbound', 'inbound']);
const VALID_OUTCOMES = new Set<CallOutcome>([
  'connected', 'no_answer', 'busy', 'voicemail', 'wrong_number', 'callback_requested',
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const { data, error } = await ctx.supabase
      .from('contact_call_logs')
      .select('*')
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .order('called_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ calls: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const body = await request.json() as {
      called_at?: string;
      direction?: string;
      duration_seconds?: number | null;
      outcome?: string;
      notes?: string | null;
    };

    const direction = (body.direction ?? 'outbound') as CallDirection;
    const outcome = (body.outcome ?? 'connected') as CallOutcome;

    if (!VALID_DIRECTIONS.has(direction)) {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
    }
    if (!VALID_OUTCOMES.has(outcome)) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 });
    }

    // Verify contact belongs to account
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .single();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from('contact_call_logs')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        user_id: ctx.userId,
        called_at: body.called_at ?? new Date().toISOString(),
        direction,
        duration_seconds: body.duration_seconds ?? null,
        outcome,
        notes: body.notes?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ call: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

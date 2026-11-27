import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  doNotContactNote,
  normaliseDoNotContactReason,
} from '@/lib/contacts/do-not-contact';

// PATCH /api/contacts/[id]/do-not-contact — turn the agent's "nothing is
// sent to this person" instruction on or off. The dispatcher, the inbound
// chain, reminders and voice campaigns all read the column; this route
// only records the decision, with a note saying who made it and why.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const limit = await checkRateLimit(
      `agent:contactDoNotContact:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json(
        { error: "'enabled' must be true or false" },
        { status: 400 }
      );
    }
    const enabled: boolean = body.enabled;
    const reason = enabled ? normaliseDoNotContactReason(body.reason) : null;

    const { data: contact, error: readError } = await ctx.supabase
      .from('contacts')
      .select('id, do_not_contact')
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    if (contact.do_not_contact === enabled) {
      return NextResponse.json({ data: { enabled, changed: false } });
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await ctx.supabase
      .from('contacts')
      .update({
        do_not_contact: enabled,
        do_not_contact_at: enabled ? now : null,
        do_not_contact_by: enabled ? ctx.userId : null,
        do_not_contact_reason: reason,
        updated_at: now,
      })
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'You do not have permission to change this contact.' },
        { status: 403 }
      );
    }

    const { error: noteError } = await ctx.supabase
      .from('contact_notes')
      .insert({
        contact_id: id,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        note_text: doNotContactNote(enabled, reason),
      });
    if (noteError) {
      console.error(
        '[contact do-not-contact] change applied but the audit note failed:',
        noteError.message
      );
    }

    return NextResponse.json({ data: { enabled, changed: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

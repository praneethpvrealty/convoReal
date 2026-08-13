// ============================================================
// PATCH /api/whatsapp/messages/[messageId]
//
// Engine-local message state: pin/unpin, and hide/restore.
//
// NEITHER REACHES WHATSAPP. Meta exposes no revoke endpoint for a sent
// message, and its pin endpoint accepts group recipients only — see
// migration 221. Hiding removes a message from this account's inbox;
// the copy on the contact's phone is untouched and cannot be recalled.
// The client must name the actions accordingly.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { MAX_PINNED_PER_CONVERSATION } from '@/lib/whatsapp/message-state';

type Action = 'pin' | 'unpin' | 'hide' | 'restore';

const ACTIONS: Action[] = ['pin', 'unpin', 'hide', 'restore'];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  // Outside the try below, whose catch reports everything as an update
  // failure. Pinning and hiding are shared-inbox state, so they carry
  // the same 'agent' gate as sending.
  let supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  let accountId: string;
  let userId: string;
  try {
    ({ supabase, accountId, userId } = await requireRole('agent'));
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const limit = await checkRateLimit(`message-state:${userId}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!limit.success) return rateLimitResponse(limit);

    const { messageId } = await params;
    const body = await request.json().catch(() => null);
    const action = body?.action as Action | undefined;

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join(', ')}` },
        { status: 400 },
      );
    }

    const { data: message } = await supabase
      .from('messages')
      .select('id, conversation_id')
      .eq('id', messageId)
      .maybeSingle();

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // RLS already scopes reads to the caller's account; this makes the
    // ownership check explicit rather than inherited, so the route is
    // still correct if it ever runs on a service-role client.
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', message.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    if (action === 'pin') {
      // WhatsApp caps a group at three pinned messages. Applying the
      // same ceiling to Engine-local pins keeps the two consistent and
      // stops the pinned bar becoming a second inbox.
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', message.conversation_id)
        .not('pinned_at', 'is', null);

      if ((count ?? 0) >= MAX_PINNED_PER_CONVERSATION) {
        return NextResponse.json(
          {
            error: `Only ${MAX_PINNED_PER_CONVERSATION} messages can be pinned at once — unpin one first.`,
            code: 'PIN_LIMIT_REACHED',
          },
          { status: 409 },
        );
      }
    }

    const patch =
      action === 'pin'
        ? { pinned_at: new Date().toISOString(), pinned_by: userId }
        : action === 'unpin'
          ? { pinned_at: null, pinned_by: null, pin_expires_at: null }
          : action === 'hide'
            ? { deleted_at: new Date().toISOString(), deleted_by: userId }
            : { deleted_at: null, deleted_by: null };

    const { error: updateError } = await supabase
      .from('messages')
      // Engine-local visibility state on a row the check above proved
      // belongs to this account.
      // eslint-disable-next-line convoreal/supabase-write-guard
      .update(patch)
      .eq('id', messageId);

    if (updateError) {
      console.error('[messages/state] update failed:', updateError.message);
      return NextResponse.json(
        { error: 'Could not update the message' },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: { id: messageId, action } });
  } catch (error) {
    console.error('[messages/state] failed:', error);
    return NextResponse.json(
      { error: 'Could not update the message' },
      { status: 500 },
    );
  }
}

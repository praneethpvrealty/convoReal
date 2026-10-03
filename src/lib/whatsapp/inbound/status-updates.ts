import {
  deliveryFailureUpdate,
  isMarketingBlockCode,
  laterSuppression,
} from '@/lib/whatsapp/delivery-failure';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logText } from './log-text';

const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

export function isValidStatusTransition(
  current: string,
  incoming: string
): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent';
  }
  if (current === 'failed') {
    return false;
  }
  const ci = ladderLevel(current);
  const ii = ladderLevel(incoming);
  if (ii < 0) return false;
  if (ci < 0) return true;
  return ii > ci;
}

export async function handleStatusUpdate(status: {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message: string;
    error_data?: {
      details?: string;
    };
  }>;
}) {
  console.log(
    `[webhook] Received status update: ${logText(status.id)} -> ${logText(status.status)}`
  );
  if (status.status === 'failed' || status.errors) {
    console.error(
      `[webhook] Status FAILED for message ${logText(status.id)} to recipient ${logText(status.recipient_id)}. Errors:`,
      JSON.stringify(status.errors, null, 2)
    );
  }

  const parsedTimestamp = Number.parseInt(status.timestamp, 10) * 1000;
  const statusAt = Number.isFinite(parsedTimestamp)
    ? new Date(parsedTimestamp)
    : new Date();
  const tsIso = statusAt.toISOString();
  // Kept typed rather than folded into the untyped payload: the
  // suppression write below reads the code back, and an `unknown` there
  // is how a block code silently stops pausing anything.
  const failure =
    status.status === 'failed' && status.errors && status.errors.length > 0
      ? deliveryFailureUpdate(status.errors, statusAt)
      : null;

  const updatePayload: Record<string, unknown> = {
    status: status.status,
    ...(failure ?? {}),
  };

  const { data: updatedMsg, error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update(updatePayload)
    .eq('message_id', status.id)
    .select('id, conversation_id');

  if (msgErr) {
    console.error('Error updating message status:', msgErr);
  } else if (!updatedMsg || updatedMsg.length === 0) {
    console.warn(
      `[webhook] Message with message_id ${logText(status.id)} not found in DB messages table.`
    );
  } else {
    console.log(
      `[webhook] Updated message status in DB for message_id ${logText(status.id)} to ${logText(status.status)}`
    );
  }

  if (
    isMarketingBlockCode(failure?.error_code) &&
    updatedMsg?.[0]?.conversation_id
  ) {
    const { data: conversation } = await supabaseAdmin()
      .from('conversations')
      .select('contact_id')
      .eq('id', updatedMsg[0].conversation_id)
      .maybeSingle();
    if (conversation?.contact_id) {
      // A 24-hour cap arriving while a 30-day experiment block stands
      // must not shorten it, so keep the later pause and the code that
      // set it.
      const { data: contactRow } = await supabaseAdmin()
        .from('contacts')
        .select(
          'whatsapp_marketing_suppressed_until, whatsapp_marketing_suppression_code'
        )
        .eq('id', conversation.contact_id)
        .maybeSingle();
      const standing = contactRow?.whatsapp_marketing_suppressed_until as
        string | null | undefined;
      const proposed = failure?.retry_after as string;
      const until = laterSuppression(standing, proposed);
      const { error: suppressError } = await supabaseAdmin()
        .from('contacts')
        .update({
          whatsapp_marketing_suppressed_until: until,
          whatsapp_marketing_suppression_code:
            until === proposed
              ? failure?.error_code
              : (contactRow?.whatsapp_marketing_suppression_code ??
                failure?.error_code),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.contact_id);
      if (suppressError) {
        console.error(
          '[webhook] failed to save marketing suppression:',
          suppressError
        );
      }
    }
  }

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle();

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr);
    return;
  }
  if (!recipient) return;

  if (!isValidStatusTransition(recipient.status, status.status)) return;

  const update: Record<string, unknown> = { status: status.status };
  if (status.status === 'sent' && !('sent_at' in update))
    update.sent_at = tsIso;
  if (status.status === 'delivered') update.delivered_at = tsIso;
  if (status.status === 'read') update.read_at = tsIso;
  if (status.status === 'failed') {
    update.error_message = updatePayload.error_info ?? 'Delivery failed';
    update.retry_after = updatePayload.retry_after ?? null;
  }

  const { error: recUpdateErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .update(update)
    .eq('id', recipient.id);

  if (recUpdateErr) {
    console.error('Error updating broadcast recipient status:', recUpdateErr);
  }
}

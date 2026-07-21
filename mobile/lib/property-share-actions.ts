// Tracking-aware actions behind the property share sheet: log an
// external (personal-WhatsApp) share on a contact's timeline, and send a
// listing through the account's own WhatsApp Business number (Meta Cloud
// API) so it lands in the shared inbox thread. The CRM send mirrors
// approveAndSendDetails — free text is only allowed inside the 24-hour
// window; outside it the caller opens the thread to send a template.

import { apiFetch, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import type { Contact, Property } from '@/lib/types';

/** Record an external share on the contact's timeline — a contact note
 *  plus last-contacted/last-inquired, mirroring the web's
 *  log-external-share dialog. Best-effort: failures don't block the
 *  WhatsApp hand-off the caller is about to make. */
export async function logExternalShare(contact: Contact, property: Property): Promise<void> {
  const { profile, session } = useAuthStore.getState();
  if (!profile?.account_id || !session?.user.id) return;
  const now = new Date().toISOString();
  const label = property.property_code
    ? `[${property.property_code}] ${property.title}`
    : property.title;
  await Promise.allSettled([
    supabase
      .from('contacts')
      .update({ last_contacted_at: now, last_inquired_property_id: property.id })
      .eq('id', contact.id),
    supabase.from('contact_notes').insert({
      contact_id: contact.id,
      user_id: session.user.id,
      account_id: profile.account_id,
      note_text: `📱 Shared via personal WhatsApp\n🏠 Property: ${label}`,
    }),
  ]);
}

export interface CrmSendOutcome {
  sent: boolean;
  conversationId?: string;
  /** Outside the 24-hour window — open this thread to send a template. */
  reengage?: boolean;
  error?: string;
}

/** Send a property share through the account's WhatsApp Business number
 *  so it's logged in the shared inbox thread. Resolves or creates the
 *  conversation first, then sends free text inside the 24-hour window;
 *  outside it, returns `reengage` with the conversation to template. */
export async function sendPropertyViaCrm(
  contact: Contact,
  message: string
): Promise<CrmSendOutcome> {
  const { profile, session } = useAuthStore.getState();
  if (!profile?.account_id) return { sent: false, error: 'No account in session' };

  const { data: existingConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let convId = existingConv?.id as string | undefined;
  if (!convId) {
    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert({
        account_id: profile.account_id,
        user_id: session?.user.id,
        contact_id: contact.id,
      })
      .select('id')
      .single();
    if (error || !newConv) {
      return { sent: false, error: error?.message ?? 'Could not open a conversation' };
    }
    convId = newConv.id;
  }

  // Free text only inside the 24-hour customer window (same guard as the
  // approve flow) — a fresh conversation has never received a message.
  let within24h = false;
  if (existingConv) {
    const { data: lastCustomerMsg } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', convId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastCustomerMsg) {
      within24h =
        Date.now() - new Date(lastCustomerMsg.created_at).getTime() < 24 * 60 * 60 * 1000;
    }
  }
  if (!within24h) {
    return { sent: false, conversationId: convId, reengage: true };
  }

  try {
    await apiFetch('/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: convId,
        message_type: 'text',
        content_text: message,
      }),
    });
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Failed to send WhatsApp message';
    const isReengagement =
      msg.includes('131047') ||
      msg.toLowerCase().includes('24 hours') ||
      msg.toLowerCase().includes('re-engagement');
    if (isReengagement) return { sent: false, conversationId: convId, reengage: true };
    return { sent: false, conversationId: convId, error: msg };
  }

  return { sent: true, conversationId: convId };
}

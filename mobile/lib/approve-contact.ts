// Port of the web's approveContact + sendPropertyDetailsHelper
// (contact-detail-view.tsx): flip the contact active, then send the
// inquired property's details through the CRM WhatsApp number. Meta
// only allows free text inside the 24-hour customer window — outside
// it the caller is pointed at the conversation's template picker.

import { apiFetch, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import type { Contact } from '@/lib/types';

/** The listing the lead inquired about, as far as approve/re-engage
 *  need it: enough to show a card and to draft the details message. */
export interface ApprovedProperty {
  id: string;
  title: string;
  location: string | null;
  google_map_link: string | null;
}

export interface ApproveOutcome {
  ok: boolean;
  /** Property details went out via WhatsApp free text. */
  sent: boolean;
  /** The property the contact inquired about, when there is one — so
   *  the celebration/thread can show and re-send it. */
  property?: ApprovedProperty;
  /** Session >24h — send a template from this conversation instead. */
  reengageConversationId?: string;
  error?: string;
}

/** The exact WhatsApp text the web's sendPropertyDetailsHelper sends —
 *  kept in one place so the approve flow and the conversation draft
 *  (re-engagement) stay byte-identical. */
export function buildPropertyDetailsMessage(property: {
  title: string;
  location: string | null;
  google_map_link: string | null;
}): string {
  return `Here are the complete details for the property "${property.title}" you inquired about:\n\n📍 *Exact Address:* ${property.location || 'Not available'}\n🗺️ *Google Maps Link:* ${property.google_map_link || 'Not available'}`;
}

export async function approveAndSendDetails(contact: Contact): Promise<ApproveOutcome> {
  const { error: updateError } = await supabase
    .from('contacts')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', contact.id);
  if (updateError) {
    return { ok: false, sent: false, error: updateError.message };
  }

  if (!contact.last_inquired_property_id) {
    return { ok: true, sent: false };
  }

  const { data: propertyRow } = await supabase
    .from('properties')
    .select('id, title, location, google_map_link')
    .eq('id', contact.last_inquired_property_id)
    .maybeSingle();
  if (!propertyRow) {
    return { ok: true, sent: false };
  }
  const property = propertyRow as ApprovedProperty;

  const { data: existingConv } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let convId = existingConv?.id as string | undefined;
  if (!convId) {
    const { profile, session } = useAuthStore.getState();
    if (!profile?.account_id) return { ok: true, sent: false };
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({
        account_id: profile.account_id,
        user_id: session?.user.id,
        contact_id: contact.id,
        status: 'open',
      })
      .select('id')
      .single();
    if (convError) {
      return { ok: true, sent: false, error: convError.message };
    }
    convId = newConv.id;
  }

  // The lead is being handled now — clear the chatbot's "Talk to an
  // Agent" handoff flag so the thread stops reading as pending.
  await supabase
    .from('conversations')
    .update({ status: 'open', updated_at: new Date().toISOString() })
    .eq('id', convId)
    .eq('status', 'pending');

  // Same guard as the web: free text only within the 24-hour window.
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
    return { ok: true, sent: false, property, reengageConversationId: convId };
  }

  const messageText = buildPropertyDetailsMessage(property);

  try {
    await apiFetch('/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: convId,
        message_type: 'text',
        content_text: messageText,
      }),
    });
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Failed to send WhatsApp message';
    const isReengagement =
      msg.includes('131047') ||
      msg.toLowerCase().includes('24 hours') ||
      msg.toLowerCase().includes('re-engagement');
    if (isReengagement) {
      return { ok: true, sent: false, property, reengageConversationId: convId };
    }
    return { ok: true, sent: false, property, error: msg };
  }

  return { ok: true, sent: true, property };
}

// Port of the web's approveContact + sendPropertyDetailsHelper
// (contact-detail-view.tsx): flip the contact active, then send the
// inquired property's complete details + showcase link through the
// CRM WhatsApp number. Meta only allows free text inside the 24-hour
// customer window — outside it the caller gets the drafted message
// (wa.me deep link) and the conversation for a template.

import { useAuthStore } from '@/lib/auth-store';
import { isReengagementError } from '@/lib/customer-window';
import { sendPropertyViaCrm } from '@/lib/property-share-actions';
import { buildInquiryDetailsMessage, propertyShowcaseUrl } from '@/lib/share-message';
import { supabase } from '@/lib/supabase';
import { getShowcaseUrl } from '@/lib/welcome-message';
import type { Contact, Property } from '@/lib/types';

export interface ApproveOutcome {
  ok: boolean;
  /** Property details went out over WhatsApp. */
  sent: boolean;
  /** How they went out: the composed free text (window open) or the
   *  approved property template (window closed). */
  channel?: 'freeform' | 'template';
  /** The property the contact inquired about, when there is one — so
   *  the celebration/thread can show and re-send it. */
  property?: Property;
  /** The drafted details message (complete specs + showcase link) —
   *  what went out on send, or what wa.me should carry on re-engage. */
  detailsMessage?: string;
  /** Session >24h — send a template from this conversation instead. */
  reengageConversationId?: string;
  error?: string;
}

/** Complete details + showcase link for a property id — the message
 *  the approve flow sends and the conversation seed draft pre-fills. */
export async function buildInquiryDraft(
  propertyId: string
): Promise<{ property: Property; message: string } | null> {
  const { data } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  const property = data as Property;
  const base = await getShowcaseUrl();
  return {
    property,
    message: buildInquiryDetailsMessage({
      property,
      url: propertyShowcaseUrl(base, property),
    }),
  };
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

  const draft = await buildInquiryDraft(contact.last_inquired_property_id);
  if (!draft) {
    return { ok: true, sent: false };
  }
  const { property, message: detailsMessage } = draft;

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

  // Template-first, server-side: an open window sends the composed
  // details as free text, a closed one sends the approved property-alert
  // template. Only when neither is possible does the caller fall back to
  // manual template selection on the thread.
  const outcome = await sendPropertyViaCrm(contact, property, detailsMessage);
  if (outcome.error && !isReengagementError(outcome.error)) {
    return { ok: true, sent: false, property, detailsMessage, error: outcome.error };
  }
  if (!outcome.sent) {
    return { ok: true, sent: false, property, detailsMessage, reengageConversationId: convId };
  }

  return { ok: true, sent: true, property, detailsMessage, channel: outcome.channel };
}

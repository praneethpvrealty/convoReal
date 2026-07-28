// Tracking-aware actions behind the property share sheet: log an
// external (personal-WhatsApp) share on a contact's timeline, and send a
// listing through the account's own WhatsApp Business number (Meta Cloud
// API) so it lands in the shared inbox thread. The CRM send is
// template-first server-side (/api/whatsapp/share-property): free text
// inside the 24-hour window, the pre-approved `new_property_alert`
// template outside it — mirroring Match Radar. Only a missing or
// unapproved template comes back unsent.

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
  /** How it was delivered: the composed free text (window open) or the
   *  pre-approved property template (window closed). */
  channel?: 'freeform' | 'template';
  /** Set when the window is closed and no APPROVED property template
   *  exists — 'NONE' (never submitted) or Meta's status (e.g.
   *  'PENDING', 'REJECTED'). The thread's template picker remains the
   *  manual fallback. */
  templateStatus?: string;
  error?: string;
}

/** Send a property share through the account's WhatsApp Business number
 *  so it's logged in the shared inbox thread. Window detection and the
 *  template fallback happen server-side; the composed message is used
 *  as-is when free text is allowed. */
export async function sendPropertyViaCrm(
  contact: Contact,
  property: Property,
  message: string
): Promise<CrmSendOutcome> {
  try {
    const res = await apiFetch<{
      data: {
        sent: boolean;
        channel?: 'freeform' | 'template';
        conversation_id?: string | null;
        template_status?: string;
      };
    }>('/api/whatsapp/share-property', {
      method: 'POST',
      body: JSON.stringify({
        contact_id: contact.id,
        property_id: property.id,
        message,
      }),
    });
    const d = res.data;
    return {
      sent: d.sent,
      channel: d.channel,
      conversationId: d.conversation_id ?? undefined,
      ...(d.sent ? {} : { templateStatus: d.template_status ?? 'NONE' }),
    };
  } catch (e) {
    return {
      sent: false,
      error: e instanceof ApiError ? e.message : 'Failed to send WhatsApp message',
    };
  }
}

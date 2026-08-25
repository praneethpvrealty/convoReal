// Tracking-aware actions behind the property share sheet: log an
// external (personal-WhatsApp) share on a contact's timeline, and send a
// listing through the account's own WhatsApp Business number (Meta Cloud
// API) so it lands in the shared inbox thread. The Engine send is
// template-first server-side (/api/whatsapp/share-property): free text
// inside the 24-hour window, the pre-approved `new_property_alert`
// template outside it — mirroring Match Radar. Only a missing or
// unapproved template comes back unsent.

import { apiFetch, ApiError, isRateLimited, isTimeout } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import type { Contact, Property } from '@/lib/types';

/** Record an external share on the contact's timeline — a contact note
 *  plus last-contacted/last-inquired, mirroring the web's
 *  log-external-share dialog — and on the property share ledger, which
 *  is what marks the recipient as already contacted on the listing's
 *  Matching Contacts list. Best-effort: failures don't block the
 *  WhatsApp hand-off the caller is about to make. */
export async function logExternalShare(
  contact: Contact,
  property: Property
): Promise<void> {
  const { profile, session } = useAuthStore.getState();
  if (!profile?.account_id || !session?.user.id) return;
  const now = new Date().toISOString();
  const label = property.property_code
    ? `[${property.property_code}] ${property.title}`
    : property.title;
  await Promise.allSettled([
    supabase
      .from('contacts')
      // Touch settled alongside the note insert below; the note is the
      // record that matters and the caller reports on it.
      // eslint-disable-next-line convoreal/supabase-write-guard
      .update({
        last_contacted_at: now,
        last_inquired_property_id: property.id,
      })
      .eq('id', contact.id),
    supabase.from('contact_notes').insert({
      contact_id: contact.id,
      user_id: session.user.id,
      account_id: profile.account_id,
      note_text: `📱 Shared via personal WhatsApp\n🏠 Property: ${label}`,
    }),
    supabase.from('property_shares').upsert(
      {
        account_id: profile.account_id,
        property_id: property.id,
        contact_id: contact.id,
        recipient_kind: contact.classification === 'Agent' ? 'agent' : 'buyer',
        channel: 'whatsapp',
        created_by: session.user.id,
      },
      {
        onConflict: 'account_id,property_id,contact_id',
        ignoreDuplicates: true,
      }
    ),
  ]);
}

/**
 * One share is several Meta Cloud API round trips server-side — the
 * listing photo, then the text or the template — on top of the window
 * lookup and the ledger write. The default 20-second budget routinely
 * abandoned a send that was still in flight, so the agent saw "the
 * server did not respond" for a message WhatsApp went on to deliver.
 */
const SHARE_TIMEOUT_MS = 60_000;

/** How many shares are in flight at once during a fan-out. Sequential
 *  sends put a 30-contact list minutes away from a verdict; the account
 *  is a single WhatsApp number, so this stays small enough not to race
 *  Meta's own per-number pacing. */
const SHARE_CONCURRENCY = 4;

/** Longest a rate-limited share waits for its window to reset before
 *  giving up. The limiter's window is a minute, so one wait covers it. */
const MAX_RETRY_WAIT_MS = 70_000;

export interface EngineSendOutcome {
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
  /** The request was abandoned before the server answered. Nothing is
   *  known about the send — it may well have gone out — so this is
   *  reported apart from a refusal the server actually returned. */
  timedOut?: boolean;
  /** Seconds until the send rate limit resets. Set only on the first
   *  attempt — a retried share reports its real verdict. */
  rateLimitedFor?: number;
}

/** Send a property share through the account's WhatsApp Business number
 *  so it's logged in the shared inbox thread. Window detection and the
 *  template fallback happen server-side; the composed message is used
 *  as-is when free text is allowed. */
export async function sendPropertyViaEngine(
  contact: Contact,
  property: Property,
  message: string
): Promise<EngineSendOutcome> {
  const outcome = await attemptShare(contact, property, message);
  // A 429 is the server asking us to wait, not a share that failed.
  // Reporting it as one is what turned a 31-contact fan-out into 30
  // "could not send" lines for messages that were never attempted.
  if (!outcome.rateLimitedFor) return outcome;
  const wait = Math.min(outcome.rateLimitedFor * 1000, MAX_RETRY_WAIT_MS);
  await new Promise((resolve) => setTimeout(resolve, wait));
  return attemptShare(contact, property, message);
}

async function attemptShare(
  contact: Contact,
  property: Property,
  message: string
): Promise<EngineSendOutcome> {
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
      timeoutMs: SHARE_TIMEOUT_MS,
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
      ...(isTimeout(e) ? { timedOut: true } : {}),
      ...(isRateLimited(e)
        ? { rateLimitedFor: (e as ApiError).retryAfterSeconds ?? 60 }
        : {}),
      error:
        e instanceof ApiError ? e.message : 'Failed to send WhatsApp message',
    };
  }
}

/**
 * Fan a share out to many contacts, a few at a time, reporting each
 * recipient's own verdict as it lands. Every contact gets their own
 * 24-hour-window check server-side, so a closed window for one must not
 * read as a failure for the rest.
 */
export async function sendPropertyViaEngineMany(
  contacts: Contact[],
  property: Property,
  messageFor: (contact: Contact) => string,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, EngineSendOutcome>> {
  const outcomes = new Map<string, EngineSendOutcome>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < contacts.length) {
      const contact = contacts[next++];
      const outcome = await sendPropertyViaEngine(
        contact,
        property,
        messageFor(contact)
      );
      outcomes.set(contact.id, outcome);
      onProgress?.(++done, contacts.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SHARE_CONCURRENCY, contacts.length) }, worker)
  );
  return outcomes;
}

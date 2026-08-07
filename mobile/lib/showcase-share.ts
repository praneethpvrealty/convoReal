// Tracking-aware showcase-catalog sharing. Two attribution modes for
// the one generic link the Properties tab shares:
//   - to a contact → ?v=<contact_id>, Pulse shows their opens by name
//   - anonymous → ?s=<share token> minted per share, Pulse shows
//     "guest via the link shared <when>" without knowing the recipient

import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { getShowcaseUrl } from '@/lib/welcome-message';
import type { Contact } from '@/lib/types';

function withParam(baseUrl: string, key: string, value: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${key}=${encodeURIComponent(value)}`;
}

/** Showcase link personalized to a contact — their opens and views show
 *  in Pulse under their name (v= attributes, never filters). */
export async function contactShowcaseShareUrl(contact: Contact): Promise<string> {
  return withParam(await getShowcaseUrl(), 'v', contact.id);
}

/** Generic showcase link carrying a fresh share-instance token
 *  (migration 173). Minting is best-effort: offline or failed, the
 *  plain link still works — that one share is just untracked. */
export async function anonymousShowcaseShareUrl(): Promise<string> {
  const base = await getShowcaseUrl();
  try {
    const res = await apiFetch<{ data: { id: string } }>('/api/showcase-shares', {
      method: 'POST',
    });
    return withParam(base, 's', res.data.id);
  } catch {
    return base;
  }
}

/** Timeline breadcrumb for a personal showcase share — the catalog
 *  cousin of logExternalShare. Best-effort: failures never block the
 *  OS share the caller is about to open. */
export async function logShowcaseShare(contact: Contact): Promise<void> {
  const { profile, session } = useAuthStore.getState();
  if (!profile?.account_id || !session?.user.id) return;
  await Promise.allSettled([
    supabase
      .from('contacts')
      // Same settled-touch as the property share: the note below is the
      // record, this only moves the last-contacted stamp.
      // eslint-disable-next-line convoreal/supabase-write-guard
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', contact.id),
    supabase.from('contact_notes').insert({
      contact_id: contact.id,
      user_id: session.user.id,
      account_id: profile.account_id,
      note_text: '🔗 Shared the showcase catalog via personal WhatsApp',
    }),
  ]);
}

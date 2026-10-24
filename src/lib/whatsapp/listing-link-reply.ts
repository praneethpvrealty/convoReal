import type { SupabaseClient } from '@supabase/supabase-js';
import { accountPropertyShowcaseUrl } from '@/lib/showcase/account-showcase-url';
import type { ShowcaseLinkProperty } from '@/lib/share-message-builder';

function linkRefs(property: ShowcaseLinkProperty): string[] {
  return [property.property_code, property.id]
    .filter((ref): ref is string => !!ref)
    .map((ref) => ref.replace(/[^A-Za-z0-9-]/g, ''))
    .filter(Boolean);
}

export async function listingLinkAlreadySent(
  db: SupabaseClient,
  conversationId: string,
  property: ShowcaseLinkProperty
): Promise<boolean> {
  const refs = linkRefs(property);
  if (refs.length === 0) return false;
  try {
    const { data, error } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .in('sender_type', ['agent', 'bot'])
      .neq('status', 'failed')
      .or(
        refs.map((ref) => `content_text.ilike.%property_id=${ref}%`).join(',')
      )
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function withListingLink(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  property: ShowcaseLinkProperty;
  text: string;
}): Promise<string> {
  const { db, accountId, conversationId, contactId, property, text } = args;
  if (await listingLinkAlreadySent(db, conversationId, property)) return text;
  const url = await accountPropertyShowcaseUrl(
    db,
    accountId,
    property,
    contactId
  );
  return `${text}\n\nFull details: ${url}`;
}

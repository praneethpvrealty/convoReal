import type { SupabaseClient } from '@supabase/supabase-js';
import { describedListingAmong } from '@/lib/ai/described-listing';
import { recentShareCandidates } from '@/lib/ai/lead-question';
import { asksDetailsOfDescribedListing } from '@/lib/ai/requirement-signal';
import {
  loadSubjectThread,
  type InboundSubjectContext,
  type SubjectThread,
} from '@/lib/learning/subject';

export function detailsRequestInThread(
  thread: SubjectThread,
  text: string | null | undefined
): string | null {
  if (!asksDetailsOfDescribedListing(text)) return null;
  return describedListingAmong(text, recentShareCandidates(thread));
}

export async function detailsRequestForSharedListing(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
  text: string | null | undefined,
  inbound?: InboundSubjectContext
): Promise<string | null> {
  if (!asksDetailsOfDescribedListing(text)) return null;
  try {
    const thread = await loadSubjectThread(
      db,
      accountId,
      contactId,
      conversationId,
      inbound
    );
    return thread ? detailsRequestInThread(thread, text) : null;
  } catch {
    return null;
  }
}

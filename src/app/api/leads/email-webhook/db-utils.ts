import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from './admin-client';

// Helper to find or create a tag and return its ID
export async function findOrCreateTag(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  tagName: string,
  color: string = '#3b82f6'
): Promise<string | null> {
  // First, try to find existing tag
  const { data: existingTag } = await supabase
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', tagName)
    .maybeSingle();

  if (existingTag) {
    return existingTag.id;
  }

  // Create new tag if not found
  const { data: newTag, error } = await supabase
    .from('tags')
    .insert({
      account_id: accountId,
      user_id: userId,
      name: tagName,
      color: color,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`[lead-webhook] Failed to create tag "${tagName}":`, error);
    return null;
  }

  return newTag?.id || null;
}

// Helper to assign tags to a contact
export async function assignTagsToContact(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  const tagColorMap: Record<string, string> = {
    Residential: '#10b981',
    Commercial: '#f59e0b',
    'Plots/Land': '#8b5cf6',
    'Flat/Apartment': '#3b82f6',
    Villa: '#ec4899',
    'Housing Lead': '#06b6d4',
    'Budget 150Cr+': '#991b1b',
    'Budget 100-150Cr': '#b91c1c',
    'Budget 50-100Cr': '#dc2626',
    'Budget 25-50Cr': '#ef4444',
    'Budget 10-25Cr': '#f43f5e',
    'Budget 5-10Cr': '#f97316',
    'Budget 2-5Cr': '#fb923c',
    'Budget 1-2Cr': '#fdba74',
    'Budget 50L-1Cr': '#fed7aa',
    'Budget 20L-50L': '#84cc16',
    'Budget <20L': '#a3e635',
  };

  for (const tagName of tagNames) {
    const tagId = await findOrCreateTag(
      supabase,
      accountId,
      userId,
      tagName,
      tagColorMap[tagName] || '#3b82f6'
    );
    if (tagId) {
      // Assign tag to contact (ignore if already assigned)
      await supabase.from('contact_tags').upsert(
        {
          contact_id: contactId,
          tag_id: tagId,
        },
        { onConflict: 'contact_id,tag_id' }
      );
    }
  }
}

/** What the lead email asked for and which listing the scorer picked —
 *  recorded so a wrong match can be spotted from the log rather than
 *  from the mailbox (migration 200). */
export interface SyncLogMatchAudit {
  parsedPropertyType?: string | null;
  parsedLocation?: string | null;
  parsedAreaSqft?: number | null;
  parsedPrice?: number | null;
  parsedBedrooms?: number | null;
  matchedPropertyId?: string | null;
  matchScore?: number | null;
  leadPortal?: string | null;
  leadPortalListingId?: string | null;
}

export async function writeSyncLog(args: {
  accountId: string;
  sender: string;
  subject: string;
  extractedName?: string | null;
  extractedPhone?: string | null;
  extractedEmail?: string | null;
  status: 'success' | 'failed' | 'ignored';
  errorMessage?: string;
  bodyPreview?: string;
  ledgerId?: string | null;
  match?: SyncLogMatchAudit;
}) {
  try {
    const supabase = getAdminClient();
    await supabase.from('email_sync_logs').insert({
      account_id: args.accountId,
      sender: args.sender || null,
      subject: args.subject || null,
      extracted_name: args.extractedName || null,
      extracted_phone: args.extractedPhone || null,
      extracted_email: args.extractedEmail || null,
      status: args.status,
      error_message: args.errorMessage || null,
      body_preview: args.bodyPreview || null,
      ledger_id: args.ledgerId || null,
      parsed_property_type: args.match?.parsedPropertyType ?? null,
      parsed_location: args.match?.parsedLocation ?? null,
      parsed_area_sqft: args.match?.parsedAreaSqft ?? null,
      parsed_price: args.match?.parsedPrice ?? null,
      parsed_bedrooms: args.match?.parsedBedrooms ?? null,
      matched_property_id: args.match?.matchedPropertyId ?? null,
      match_score: args.match?.matchScore ?? null,
      lead_portal: args.match?.leadPortal ?? null,
      lead_portal_listing_id: args.match?.leadPortalListingId ?? null,
    });
  } catch (err) {
    console.error('[lead-webhook] Failed to write sync log:', err);
  }
}

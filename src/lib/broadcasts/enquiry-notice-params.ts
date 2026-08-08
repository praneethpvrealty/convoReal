// Per-recipient parameters for the property-anchored re-engagement
// template.
//
// Every other broadcast variable resolves from a column on the contact
// row. This one needs the property each lead enquired about, so it is
// loaded once for the whole batch here and looked up per recipient.
//
// A recipient whose property cannot be resolved must not receive this
// template at all: Meta rejects empty body params, and "Property: "
// with nothing after it is worse than not sending. Those are reported
// so the caller can route them to the generic status template instead
// of silently dropping them.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property } from '@/types';
import {
  buildEnquiryNoticeParams,
  buildEnquiryNoticeTextParams,
  enquiryNoticeParamCount,
} from '@/lib/whatsapp/enquiry-notice-template';
import { extractEnquiredPropertyFromNote } from '@/lib/contacts/enquiry-note';

export interface EnquiryNoticeContext {
  /** Enquired property per contact id. */
  enquired: Map<string, Property>;
  /** For contacts with no resolvable property: the enquiry as the
   *  portal phrased it, recovered from the lead's notes. */
  enquiryText: Map<string, string>;
  /** The brokerage the notice is signed with — one value for the whole
   *  batch. Absent only when the account has no name set, in which case
   *  the param builder falls back rather than sending unsigned. */
  brandName?: string | null;
  /** The template the batch is going out under: the signed revision
   *  carries the brokerage as {{2}}, the legacy one has no such param,
   *  and Meta rejects a send whose count does not match. */
  templateName?: string;
}

export type EnquiryNoticeFailure = 'no_enquired_property';

/** Load the enquired property for a batch of contacts — one query
 *  regardless of batch size. */
export async function loadEnquiryNoticeContext(
  db: SupabaseClient,
  accountId: string,
  contacts: readonly Contact[],
  templateName?: string
): Promise<EnquiryNoticeContext> {
  const enquired = new Map<string, Property>();
  const enquiryText = new Map<string, string>();
  const { data: acct } = await db
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  const brandName = (acct?.name as string | null) ?? null;
  if (contacts.length === 0)
    return { enquired, enquiryText, brandName, templateName };

  const enquiredIdByContact = new Map<string, string>();
  for (const c of contacts) {
    const pid = (c as Contact & { last_inquired_property_id?: string | null })
      .last_inquired_property_id;
    if (pid) enquiredIdByContact.set(c.id, pid);
  }


  if (enquiredIdByContact.size > 0) {
    const { data } = await db
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .in('id', [...new Set(enquiredIdByContact.values())]);

    const propertyById = new Map<string, Property>();
    for (const p of (data ?? []) as Property[]) propertyById.set(p.id, p);

    for (const [contactId, propertyId] of enquiredIdByContact) {
      const p = propertyById.get(propertyId);
      if (p) enquired.set(contactId, p);
    }
  }

  // A portal lead's enquired listing is usually expired and was never
  // in inventory, so the id resolves to nothing — but the import
  // stored the portal's own description of the enquiry as a note.
  // That prose is a perfectly good property param: params cannot change
  // an approved template's category, so naming the enquiry this way
  // carries no reclassification risk.
  const needText = contacts.map((c) => c.id).filter((id) => !enquired.has(id));
  if (needText.length > 0) {
    const { data: notes } = await db
      .from('contact_notes')
      .select('contact_id, note_text')
      .eq('account_id', accountId)
      .in('contact_id', needText)
      .order('created_at', { ascending: false });

    // Newest parseable note wins — a fresher enquiry supersedes.
    for (const n of (notes ?? []) as {
      contact_id: string;
      note_text: string | null;
    }[]) {
      if (enquiryText.has(n.contact_id)) continue;
      const description = extractEnquiredPropertyFromNote(n.note_text);
      if (description) enquiryText.set(n.contact_id, description);
    }
  }

  return { enquired, enquiryText, brandName, templateName };
}

/**
 * The body params for this contact, or the reason they cannot be
 * built. Pure given a loaded context, so the routing rule is testable
 * without a database.
 */
export function resolveEnquiryNoticeParams(
  contact: Pick<Contact, 'id' | 'name'>,
  ctx: EnquiryNoticeContext
): { params: string[] } | { failure: EnquiryNoticeFailure } {
  const enquired = ctx.enquired.get(contact.id);
  const text = ctx.enquiryText.get(contact.id);
  let params: [string, string, string] | null = null;
  if (enquired) {
    params = buildEnquiryNoticeParams(contact.name, enquired, ctx.brandName);
  } else if (text) {
    params = buildEnquiryNoticeTextParams(contact.name, text, ctx.brandName);
  }
  if (!params) return { failure: 'no_enquired_property' };
  // The legacy name has no brokerage param. Drop it rather than send a
  // spare, which Meta rejects outright.
  return {
    params:
      ctx.templateName && enquiryNoticeParamCount(ctx.templateName) === 2
        ? [params[0], params[2]]
        : params,
  };
}

export const ENQUIRY_NOTICE_FAILURE_REASONS: Record<
  EnquiryNoticeFailure,
  string
> = {
  no_enquired_property:
    'No enquired property or requirement text on this lead — import a property or requirement column, or send the general enquiry status template instead.',
};

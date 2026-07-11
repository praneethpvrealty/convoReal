// ============================================================
// Intake core — transport-free validation, status, and preview
// formatting for the property/contact ingestion pipeline.
//
// Pure functions only: no Supabase, no WhatsApp, no network. The
// WhatsApp owner chatbot (chatbot-engine.ts), the planned web intake
// funnels, and the dev simulator all share this core so the rules for
// "is this draft complete?" and "what does the confirm/collect state
// look like?" live in exactly one place.
// ============================================================

import type { ParsedPropertyDraft, ParsedContactDraft, ParsedContactDraftsContainer } from '@/lib/ai/gemini';
import { resolveLocationFromGoogleMapLink } from '@/lib/maps/resolve-location';

/**
 * Draft session lifecycle status. A draft with all mandatory fields
 * is ready to confirm; otherwise it stays in collecting until the
 * user supplies the rest.
 */
export type DraftStatus = 'awaiting_confirmation' | 'collecting';

/** The one place the "valid → confirm, invalid → collect" rule lives.
 *  Replaces the `isValid ? 'awaiting_confirmation' : 'collecting'`
 *  ternary that was duplicated across every draft-mutation branch. */
export function deriveDraftStatus(isValid: boolean): DraftStatus {
  return isValid ? 'awaiting_confirmation' : 'collecting';
}

/**
 * If the draft is still missing a location but has a Google Maps link
 * (common when a lister shares a pin instead of typing an address),
 * best-effort resolve the link into a usable location string. Never
 * throws — a failed/timed-out resolution just leaves the draft as-is so
 * it doesn't block the WhatsApp reply.
 */
export async function backfillLocationFromMapLink(draft: ParsedPropertyDraft): Promise<ParsedPropertyDraft> {
  if (draft.location || !draft.google_map_link) return draft;
  const derived = await resolveLocationFromGoogleMapLink(draft.google_map_link);
  return derived ? { ...draft, location: derived } : draft;
}

/**
 * Validates the parsed draft to check for missing mandatory details.
 */
export function validateDraft(draft: ParsedPropertyDraft): {
  isValid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  if (!draft.title || draft.title.trim().length === 0) {
    missingFields.push('Title');
  }

  if (draft.listing_type === 'Rent') {
    if (!draft.rent_per_month || draft.rent_per_month <= 0) {
      missingFields.push('Rent');
    }
  } else {
    if (!draft.price || draft.price <= 0) {
      missingFields.push('Price');
    }
  }

  if (!draft.location || draft.location.trim().length === 0) {
    missingFields.push('Location');
  }

  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

export function validateContactDraftsContainer(container: ParsedContactDraftsContainer): {
  isValid: boolean;
  missingFields: string[];
  invalidCount: number;
} {
  const missingFields: string[] = [];
  let invalidCount = 0;

  if (!container.contacts || container.contacts.length === 0) {
    missingFields.push('No contacts found');
    return { isValid: false, missingFields, invalidCount: 0 };
  }

  container.contacts.forEach((contact, idx) => {
    const contactMissing: string[] = [];
    if (!contact.name || contact.name.trim().length === 0) {
      contactMissing.push(`Contact #${idx + 1} Name`);
    }
    if (!contact.phone || contact.phone.trim().length === 0) {
      contactMissing.push(`Contact #${idx + 1} Phone`);
    }
    if (contactMissing.length > 0) {
      invalidCount++;
      missingFields.push(...contactMissing);
    }
  });

  return {
    isValid: invalidCount === 0,
    missingFields,
    invalidCount
  };
}

/**
 * Renders a WhatsApp-markdown preview of a property draft, including
 * the confirm/collect call-to-action footer. Pure string formatting —
 * the web funnels will render the same draft differently, but the
 * field-selection logic (rent vs sale, commercial/land vs residential)
 * is shared here.
 */
export function formatDraftPreviewMessage(
  header: string,
  draft: ParsedPropertyDraft,
  nextStatus: string,
  missingFields: string[]
): string {
  const isCommOrLand = draft.type ? (
    draft.type.toLowerCase().includes('commercial') ||
    draft.type.toLowerCase().includes('industrial') ||
    draft.type.toLowerCase().includes('warehouse') ||
    draft.type.toLowerCase().includes('godown') ||
    draft.type.toLowerCase().includes('agricultural') ||
    draft.type.toLowerCase().includes('land') ||
    draft.type.toLowerCase().includes('plot')
  ) : false;

  const isRent = draft.listing_type === 'Rent';

  let reply = `${header}\n\n` +
    `*Title:* ${draft.title || '❓ _Missing_'}\n`;

  if (isRent) {
    reply += `*Rent:* ${draft.rent_per_month ? '₹' + draft.rent_per_month.toLocaleString('en-IN') + '/month' : '❓ _Missing_'}\n` +
             `*Maintenance:* ${draft.maintenance ? '₹' + draft.maintenance.toLocaleString('en-IN') + '/month' : '_Not specified_'}\n` +
             `*Advance:* ${draft.advance ? '₹' + draft.advance.toLocaleString('en-IN') : '_Not specified_'}\n` +
             `*GST:* ${draft.gst ? (draft.gst <= 100 ? draft.gst + '%' : '₹' + draft.gst.toLocaleString('en-IN')) : '_Not specified_'}\n`;
  } else {
    reply += `*Price:* ${draft.price ? '₹' + draft.price.toLocaleString('en-IN') : '❓ _Missing_'}\n`;
  }

  reply += `*Location:* ${draft.location || '❓ _Missing_'}\n` +
    `*Type:* ${draft.type || '❓ _Missing_'}\n` +
    `*Area:* ${draft.area_sqft ? draft.area_sqft + ' Sq.Ft.' : '_Not specified_'}\n` +
    (draft.land_area ? `*Land Area:* ${draft.land_area} ${draft.land_area_unit || 'Sq.Ft.'}\n` : '') +
    (isCommOrLand ? '' : `*Beds/Baths:* ${draft.bedrooms ? draft.bedrooms + ' BHK' : '_Not specified_'} / ${draft.bathrooms ? draft.bathrooms + ' Bath' : '_Not specified_'}\n`);

  if (!isRent && draft.rental_income) {
    reply += `*Rent:* ₹${draft.rental_income.toLocaleString('en-IN')}/month\n`;
  }
  if (!isRent && draft.roi) {
    reply += `*ROI (Yield):* ${draft.roi}%\n`;
  }
  if (draft.google_map_link) {
    reply += `*Google Map Link:* ${draft.google_map_link}\n`;
  }
  if (draft.features && draft.features.length > 0) {
    reply += `*Amenities:* ${draft.features.join(', ')}\n`;
  }
  if (draft.nearby_highlights && draft.nearby_highlights.length > 0) {
    reply += `*Nearby Highlights:* ${draft.nearby_highlights.join(', ')}\n`;
  }
  if (draft.owner_contact_name) {
    const rolePart = draft.owner_contact_role ? ` [${draft.owner_contact_role}]` : '';
    const phonePart = draft.owner_contact_phone ? ` (${draft.owner_contact_phone})` : '';
    reply += `*Listing Owner/Agent:* ${draft.owner_contact_name}${phonePart}${rolePart}\n`;
  }

  reply += `*Images:* ${draft.images.length} attached\n` +
    `*Documents:* ${(draft.documents || []).length} attached\n\n` +
    (nextStatus === 'awaiting_confirmation'
      ? "✅ All mandatory fields populated!\n• Use the buttons below to Confirm or Cancel.\n• Send more updates to correct details."
      : `⚠️ *Still missing:* ${missingFields.join(', ')}.\n• Use the Cancel button below to discard.\n• Reply with details to complete.`);

  return reply;
}

/**
 * Renders a WhatsApp-markdown preview of parsed contact drafts. Pure
 * string formatting: duplicate-detection against the CRM is a data
 * concern the caller resolves first, passing per-contact warning
 * strings (index-aligned with `container.contacts`, `null` for no
 * duplicate). Keeps the DB lookups out of the formatter so the web
 * funnels and tests can render without a Supabase client.
 */
export function formatContactDraftsPreview(
  header: string,
  container: ParsedContactDraftsContainer,
  nextStatus: string,
  missingFields: string[],
  duplicateWarnings: (string | null)[] = []
): string {
  let reply = `${header}\n\n`;

  if (container.contacts && container.contacts.length > 0) {
    for (let idx = 0; idx < container.contacts.length; idx++) {
      const draft = container.contacts[idx];
      const duplicateWarning = duplicateWarnings[idx] ?? '';

      reply += `*Contact #${idx + 1}:*\n` +
        `• *Name:* ${draft.name || '❓ _Missing_'}\n` +
        `• *Phone:* ${draft.phone || '❓ _Missing_'}\n` +
        `• *Email:* ${draft.email || '_Not specified_'}\n` +
        `• *Company:* ${draft.company || '_Not specified_'}\n` +
        `• *Role/Classification:* ${draft.classification || 'Others'}\n` +
        (draft.referrer_name ? `• *Referrer:* ${draft.referrer_name}${draft.referrer_phone ? ' (' + draft.referrer_phone + ')' : ''}\n` : '') +
        `• *Notes:* ${draft.notes || '_No notes_'}\n` +
        (draft.requirements ? `• *Requirements:* ${draft.requirements}\n` : '') +
        (duplicateWarning ? `${duplicateWarning}\n` : '') +
        `\n`;
    }
  } else {
    reply += `_No contacts parsed._\n\n`;
  }

  if (nextStatus === 'awaiting_confirmation') {
    reply += `✅ All mandatory fields populated for *${container.contacts.length}* contact(s)!\n• Use the buttons below to Confirm or Cancel.\n• Send updates to correct details.`;
  } else {
    reply += `⚠️ *Still missing:* ${missingFields.join(', ')}.\n• Use the Cancel button below to discard.\n• Reply with details to complete.`;
  }

  return reply;
}

/** Combines two free-text fields (notes / requirements), trimming and
 *  de-duplicating so re-forwarding overlapping details doesn't pile up
 *  repeated sentences. Returns null when both are empty. */
export function mergeFreeText(a: string | null | undefined, b: string | null | undefined): string | null {
  const left = (a || '').trim();
  const right = (b || '').trim();
  if (!left) return right || null;
  if (!right) return left || null;
  if (left.toLowerCase().includes(right.toLowerCase())) return left;
  if (right.toLowerCase().includes(left.toLowerCase())) return right;
  return `${left}\n${right}`;
}

/** Merges one incoming parsed contact into an existing draft contact.
 *  Existing identity fields (name/phone/email/company/referrer) win so a
 *  follow-up screenshot that lacks them doesn't blank them out; the
 *  classification upgrades away from the generic 'Others'; free-text
 *  notes/requirements are concatenated. */
export function mergeContactDraft(base: ParsedContactDraft, add: ParsedContactDraft): ParsedContactDraft {
  return {
    name: base.name ?? add.name,
    phone: base.phone ?? add.phone,
    email: base.email ?? add.email,
    company: base.company ?? add.company,
    classification:
      base.classification && base.classification !== 'Others'
        ? base.classification
        : add.classification,
    notes: mergeFreeText(base.notes, add.notes),
    requirements: mergeFreeText(base.requirements, add.requirements),
    referrer_name: base.referrer_name ?? add.referrer_name,
    referrer_phone: base.referrer_phone ?? add.referrer_phone,
  };
}

/**
 * Merges a freshly-parsed container INTO an active draft so forwarding an
 * additional screenshot/text enriches the current contact instead of
 * spawning a new draft that drops the name/phone captured earlier.
 * Contacts merge by position; any incoming contacts beyond the existing
 * count are appended as genuinely new drafts.
 */
export function mergeContactDraftsContainer(
  existing: ParsedContactDraftsContainer,
  incoming: ParsedContactDraftsContainer
): ParsedContactDraftsContainer {
  const existingContacts = existing.contacts || [];
  const incomingContacts = incoming.contacts || [];
  if (existingContacts.length === 0) return { contacts: incomingContacts };

  const merged = existingContacts.map((base, idx) =>
    incomingContacts[idx] ? mergeContactDraft(base, incomingContacts[idx]) : base
  );
  if (incomingContacts.length > existingContacts.length) {
    merged.push(...incomingContacts.slice(existingContacts.length));
  }
  return { contacts: merged };
}

import type { Property } from '@/types';

/**
 * Prefill generator for the "Share via Email" draft — pure, transport-
 * free text builder matching the structured format agents already use
 * when emailing land/JV opportunities by hand (land extension, land use,
 * ownership, deal proposal, location, sketch, remarks). The caller opens
 * this in the agent's own mail client; nothing here sends email.
 */

export type ShareEmailProperty = Pick<
  Property,
  | 'title' | 'type' | 'listing_type' | 'price' | 'rent_per_month' | 'maintenance'
  | 'location' | 'sublocality' | 'city' | 'google_map_link' | 'nearby_highlights'
  | 'land_area' | 'land_area_unit' | 'land_zone' | 'land_use_zoning' | 'ownership_status'
  | 'deal_remarks' | 'jv_structure' | 'owner_share_percent' | 'builder_share_percent'
  | 'goodwill_amount' | 'documents' | 'property_code'
>;

export interface PropertyShareEmailOptions {
  /** First names of the selected recipients, used to build the greeting line. */
  recipientNames?: string[];
  agentName?: string | null;
  agentPhone?: string | null;
}

export interface PropertyShareEmailContent {
  subject: string;
  body: string;
}

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function formatLandExtent(p: ShareEmailProperty): string | null {
  if (!p.land_area) return null;
  return `${p.land_area} ${p.land_area_unit || 'Sq.Ft.'}`;
}

function dealTypeLabel(listingType: string): string {
  switch (listingType) {
    case 'JV/JD':
      return 'JD Opportunity';
    case 'Built to Suit':
      return 'Built to Suit Opportunity';
    case 'Rent':
      return 'Rental Opportunity';
    default:
      return 'Outright Opportunity';
  }
}

/** Builds the subject/body of a prefilled "Share via Email" draft for one property. */
export function buildPropertyShareEmailContent(
  property: ShareEmailProperty,
  opts: PropertyShareEmailOptions = {}
): PropertyShareEmailContent {
  const listingType = property.listing_type || 'Sale';
  const extent = formatLandExtent(property);
  const locationLabel = [property.sublocality, property.city].filter(Boolean).join(', ') || property.location || '';

  const subjectParts = [dealTypeLabel(listingType)];
  if (extent) subjectParts.push(extent);
  if (locationLabel) subjectParts.push(locationLabel);
  const subject = subjectParts.join(' || ');

  const greetingNames = (opts.recipientNames || []).filter(Boolean);
  const greeting = greetingNames.length > 0 ? `Hi ${greetingNames.join(' and ')},` : 'Hi,';

  const lines: string[] = [greeting, '', 'Greetings of the day!', '', 'Please find the details below :', ''];

  if (extent) lines.push(`Land extension - ${extent}`);

  const landUse = property.land_use_zoning || property.land_zone || null;
  if (landUse) lines.push(`Land use - ${landUse}`);

  if (property.ownership_status) lines.push(`Ownership - ${property.ownership_status}`);

  if (listingType === 'JV/JD') {
    const hasShare = !!(property.owner_share_percent && property.builder_share_percent);
    const proposal = hasShare
      ? `${property.owner_share_percent}:${property.builder_share_percent} share (owner:builder)${property.jv_structure ? `, ${property.jv_structure}` : ''}${property.goodwill_amount ? `, Goodwill ${inr(property.goodwill_amount)}` : ''}`
      : 'To be discussed.';
    lines.push(`JD proposal - ${proposal}`);
  } else if (listingType === 'Rent' || listingType === 'Built to Suit') {
    if (property.rent_per_month) {
      lines.push(
        `Proposal - ${inr(property.rent_per_month)}/month${property.maintenance ? ` + ${inr(property.maintenance)} maintenance` : ''}`
      );
    }
  } else if (property.price) {
    lines.push(`Proposal - ${inr(property.price)}`);
  }

  if (property.google_map_link) {
    lines.push(`Location: ${property.google_map_link}`);
  } else if (locationLabel) {
    lines.push(`Location: ${locationLabel}`);
  }

  if (property.nearby_highlights && property.nearby_highlights.length > 0) {
    lines.push(`Landmark: ${property.nearby_highlights[0]}`);
  }

  const docCount = property.documents?.length || 0;
  if (docCount > 0) {
    lines.push(
      `Sketch: Attached (remember to attach ${docCount === 1 ? 'the file' : `all ${docCount} files`} from the listing's documents before sending — this draft can't carry attachments).`
    );
  }

  if (property.deal_remarks) lines.push(`Remarks: ${property.deal_remarks}`);

  lines.push('', 'Please let me know if you have any questions.', '', 'Regards,');
  if (opts.agentName) lines.push(opts.agentName);
  if (opts.agentPhone) lines.push(opts.agentPhone);

  return { subject, body: lines.join('\n') };
}

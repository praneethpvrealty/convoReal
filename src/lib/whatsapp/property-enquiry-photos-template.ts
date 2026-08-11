// The predefined "property_enquiry_photos" WhatsApp template — the
// photo-first counterpart of property_enquiry_response. Agents were
// reaching for the hand-made Marketing template
// share_property_details_with_image to lead with a property photo, and
// Meta's per-user marketing cap silently dropped ~half of those sends
// with error 131049. This is the Utility replacement: same image-header
// send, exempt from the cap. The image itself is supplied at send time
// via headerMediaUrl (the picker / share flows pass the property's
// photo); the sample below is only for Meta's review.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { DEFAULT_LANGUAGE, metaLanguageCode, type LanguageCode } from '@/lib/languages';
import { templateBody, templateButtonLabel } from '@/lib/whatsapp/template-copy';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

/**
 * Renamed once, for the same reason property_enquiry_info was:
 *
 *   property_enquiry_photos  → approved as Utility and still sending,
 *     but its URL button carries the DASHBOARD host, because the
 *     builder's only caller was a client component with nothing but
 *     window.location.origin to pass. Correcting that means an edit,
 *     and an edit is a fresh Meta review that could land a working
 *     Utility template in Marketing permanently.
 *
 * So the branded version ships under a name Meta has not ruled on. The
 * old row keeps sending untouched while this is under review, and if
 * Meta classifies it Marketing it is simply never selected — see
 * pickPropertyPhotosTemplate. property_enquiry_info took exactly this
 * route and came back Utility with the subdomain intact.
 */
export const PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME = 'listing_photos_notice';

/** Earlier names, newest first. */
export const LEGACY_PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAMES = [
  'property_enquiry_gallery',
  'property_enquiry_photos',
];

export const PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAMES = [
  PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME,
  ...LEGACY_PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAMES,
];

/** The photo-header property template a send should use. */
export function pickPropertyPhotosTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[],
): T | null {
  return pickApprovedTemplate(rows, PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAMES);
}

export function buildPropertyEnquiryPhotosTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE,
): TemplatePayload {
  const base = origin.replace(/\/+$/, '');
  return {
    name: PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME,
    // Utility under Meta's two-part test: non-promotional AND specific
    // to the recipient's own request — same classifier-safe wording
    // rules as property_enquiry_response (no sales CTA, no emoji/bold
    // ad-card, labelled transaction-notice fields). Mixed
    // utility+marketing content classifies the whole template as
    // Marketing regardless of the submitted category.
    category: 'Utility',
    language: metaLanguageCode(language),
    header_type: 'image',
    // Review-time sample only — a stable PNG every deployment serves.
    // Real sends override it with the property photo (headerMediaUrl).
    header_media_url: `${base}/brand/app-icon-1024.png`,
    body_text: templateBody('property_enquiry_photos', language),
    buttons: [
      // Same button set as property_enquiry_response: the quick reply
      // opens the 24h window, the URL carries the requested listing.
      { type: 'QUICK_REPLY', text: templateButtonLabel('send_more_details', language) },
      {
        type: 'URL',
        text: templateButtonLabel('view_full_details', language),
        url: `${base}/{{1}}`,
        example: '?property_id=abc&v=contact-id',
      },
    ],
    // Body params {{1}}..{{5}} match buildPropertyAlertParams exactly
    // (first name, brokerage, title, specs, locality), so both enquiry
    // templates share one params builder — and propertyShareParams
    // trims it for whichever predecessor is still sending.
    sample_values: {
      body: [
        'Gopi',
        'Aryavarta Ventures',
        'Commercial Property for Sale in Hoodi, Bangalore',
        '₹32 Cr · 23,500 Sq.Ft.',
        'Hoodi, Bangalore',
      ],
    },
  };
}

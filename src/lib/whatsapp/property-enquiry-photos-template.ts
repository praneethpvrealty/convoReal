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

export const PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME = 'property_enquiry_photos';

export function buildPropertyEnquiryPhotosTemplatePayload(
  origin: string,
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
    language: 'en_US',
    header_type: 'image',
    // Review-time sample only — a stable PNG every deployment serves.
    // Real sends override it with the property photo (headerMediaUrl).
    header_media_url: `${base}/brand/app-icon-1024.png`,
    body_text: [
      'Hi {{1}}, sharing the photos you requested for your property enquiry:',
      '',
      'Property: {{2}}',
      'Details: {{3}}',
      'Location: {{4}}',
      '',
      'Reply to this message if you need any further information about this enquiry.',
    ].join('\n'),
    buttons: [
      // Same button set as property_enquiry_response: the quick reply
      // opens the 24h window, the URL carries the requested listing.
      { type: 'QUICK_REPLY', text: 'Send more details' },
      {
        type: 'URL',
        text: 'View full details',
        url: `${base}/{{1}}`,
        example: '?property_id=abc&v=contact-id',
      },
    ],
    // Body params {{1}}..{{4}} match buildPropertyAlertParams exactly
    // (first name, title, specs, locality), so both enquiry templates
    // share one params builder.
    sample_values: {
      body: [
        'Gopi',
        'Commercial Property for Sale in Hoodi, Bangalore',
        '₹32 Cr · 23,500 Sq.Ft.',
        'Hoodi, Bangalore',
      ],
    },
  };
}

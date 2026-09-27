// The predefined "listing_availability_notice" WhatsApp template — what a
// portal lead hears, outside the 24-hour window, when the listing they
// enquired about is under contract, off the market or no longer listed.
//
// listing_status_notice already covers that case, but it says the
// listing "is no longer available, so your enquiry cannot be fulfilled
// as filed" — true of a sold flat, wrong for one whose deal may still
// fall through. This template is that approved copy with three changes
// and nothing else:
//
//   - a "Status: {{4}}" line naming where the listing stands;
//   - the unavailability sentence apologises, says "not available right
//     now", and promises an update if it frees up — a promise the
//     status-change notifier keeps for every enquirer;
//   - the reply ask names requirements and budget.
//
// Same Utility category, same two buttons, no emoji, no footer, no
// button that offers new inventory. See the enquiry_notice header for
// the category history that makes that discipline necessary. A Sold
// listing never uses this template: it cannot become available again,
// so it stays on listing_status_notice.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import {
  templateBody,
  templateButtonLabel,
} from '@/lib/whatsapp/template-copy';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';
import { buildEnquiryNoticeParams } from '@/lib/whatsapp/enquiry-notice-template';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';
import type { Property } from '@/types';

export const LISTING_AVAILABILITY_TEMPLATE_NAME = 'listing_availability_notice';

export function pickListingAvailabilityTemplate<
  T extends ApprovedTemplateCandidate,
>(rows: T[]): T | null {
  return pickApprovedTemplate(rows, [LISTING_AVAILABILITY_TEMPLATE_NAME]);
}

export function buildListingAvailabilityTemplatePayload(
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  return {
    name: LISTING_AVAILABILITY_TEMPLATE_NAME,
    category: 'Utility',
    language: metaLanguageCode(language),
    body_text: templateBody('listing_availability', language),
    buttons: [
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('update_preferences', language),
      },
      {
        type: 'QUICK_REPLY',
        text: templateButtonLabel('close_enquiry', language),
      },
    ],
    sample_values: {
      body: [
        'Praneeth',
        'Aryavarta Ventures',
        '3 BHK at Prestige Lakeside Habitat, Whitefield',
        listingAvailabilityStatusLabel('Under Contract', language),
      ],
    },
  };
}

type StatusKind = 'under_contract' | 'off_market' | 'not_listed';

const STATUS_LABELS: Record<StatusKind, Record<LanguageCode, string>> = {
  under_contract: {
    en: 'Under contract',
    hi: 'अनुबंध के तहत',
    kn: 'ಒಪ್ಪಂದದ ಹಂತದಲ್ಲಿದೆ',
    ta: 'ஒப்பந்த நிலையில் உள்ளது',
    te: 'ఒప్పంద దశలో ఉంది',
    ml: 'കരാർ ഘട്ടത്തിലാണ്',
    mr: 'करार प्रक्रियेत',
  },
  off_market: {
    en: 'Off the market for now',
    hi: 'फ़िलहाल बाज़ार से हटाई गई',
    kn: 'ಸದ್ಯ ಮಾರುಕಟ್ಟೆಯಿಂದ ಹಿಂಪಡೆಯಲಾಗಿದೆ',
    ta: 'தற்போது சந்தையில் இல்லை',
    te: 'ప్రస్తుతం మార్కెట్‌లో లేదు',
    ml: 'ഇപ്പോൾ വിപണിയിലില്ല',
    mr: 'सध्या बाजारातून काढलेली',
  },
  not_listed: {
    en: 'Not actively listed',
    hi: 'अभी सक्रिय रूप से सूचीबद्ध नहीं',
    kn: 'ಸದ್ಯ ಸಕ್ರಿಯವಾಗಿ ಪಟ್ಟಿಯಲ್ಲಿಲ್ಲ',
    ta: 'தற்போது பட்டியலில் இல்லை',
    te: 'ప్రస్తుతం జాబితాలో లేదు',
    ml: 'ഇപ്പോൾ ലിസ്റ്റിൽ ഇല്ല',
    mr: 'सध्या सूचीत नाही',
  },
};

export function listingAvailabilityStatusLabel(
  status: string | null | undefined,
  language: LanguageCode = DEFAULT_LANGUAGE
): string {
  const kind: StatusKind =
    status === 'Under Contract'
      ? 'under_contract'
      : status === 'Off Market'
        ? 'off_market'
        : 'not_listed';
  return STATUS_LABELS[kind][language] ?? STATUS_LABELS[kind].en;
}

/** Body params {{1}}..{{4}}: first name, brokerage, the enquired
 *  property, and its status in the template's own language. */
export function buildListingAvailabilityParams(
  contactName: string | null | undefined,
  property: Property,
  brandName: string | null | undefined,
  language: LanguageCode = DEFAULT_LANGUAGE
): [name: string, brand: string, property: string, status: string] {
  const [name, brand, described] = buildEnquiryNoticeParams(
    contactName,
    property,
    brandName
  );
  return [
    name,
    brand,
    described,
    sanitizeTemplateParam(
      listingAvailabilityStatusLabel(property.status, language)
    ),
  ];
}

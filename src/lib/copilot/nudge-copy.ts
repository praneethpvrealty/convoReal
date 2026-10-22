import type { LanguageCode } from '../languages';

export type NudgeId =
  | 'sessions-expiring'
  | 'hot-leads-quiet'
  | 'journeys-stalled'
  | 'radar-matches'
  | 'pulse-weekly-views'
  | 'setup-whatsapp'
  | 'setup-property'
  | 'setup-contact'
  | 'setup-email-leads'
  | 'setup-showcase-brand';

export interface NudgeCopy {
  message: string;
  ctaLabel: string;
}

type Writer = (count: number) => NudgeCopy;

const EN: Record<NudgeId, Writer> = {
  'sessions-expiring': (n) => ({
    message:
      n === 1
        ? '1 customer chat will close soon — reply before the WhatsApp window ends.'
        : `${n} customer chats will close soon — reply before the WhatsApp window ends.`,
    ctaLabel: 'Open Inbox',
  }),
  'hot-leads-quiet': (n) => ({
    message:
      n === 1
        ? '1 hot lead hasn’t heard from you in 2+ days. A quick message keeps them warm!'
        : `${n} hot leads haven’t heard from you in 2+ days. A quick message keeps them warm!`,
    ctaLabel: 'See leads',
  }),
  'journeys-stalled': (n) => ({
    message:
      n === 1
        ? '1 property has sat at the same journey stage for over a week. Ask the buyer if it is still in play.'
        : `${n} properties have sat at the same journey stage for over a week. Ask the buyers if they are still in play.`,
    ctaLabel: 'Open Journey',
  }),
  'radar-matches': (n) => ({
    message:
      n === 1
        ? 'Found 1 new buyer–property match for you. Take a look!'
        : `Found ${n} new buyer–property matches for you. Take a look!`,
    ctaLabel: 'Open Match Radar',
  }),
  'pulse-weekly-views': (n) => ({
    message: `Did you know? Your properties got ${n} views this week \u{1F440}`,
    ctaLabel: 'Show me',
  }),
  'setup-whatsapp': () => ({
    message: 'Connect WhatsApp to unlock customer chats and broadcasts.',
    ctaLabel: 'Set it up',
  }),
  'setup-property': () => ({
    message: 'Add your first property — it takes about a minute.',
    ctaLabel: 'Show me how',
  }),
  'setup-contact': () => ({
    message: 'Add your first contact — it takes about a minute.',
    ctaLabel: 'Show me how',
  }),
  'setup-email-leads': () => ({
    message:
      'Getting leads on 99acres, MagicBricks or Housing? Forward them in and they become WhatsApp contacts automatically.',
    ctaLabel: 'Show me how',
  }),
  'setup-showcase-brand': () => ({
    message:
      'Your property links still show default branding. Put your own name on every page you share — takes two minutes.',
    ctaLabel: 'Brand my pages',
  }),
};

const HI: Record<NudgeId, Writer> = {
  'sessions-expiring': (n) => ({
    message:
      n === 1
        ? '1 ग्राहक की चैट जल्द बंद हो जाएगी — WhatsApp विंडो खत्म होने से पहले जवाब दें।'
        : `${n} ग्राहकों की चैट जल्द बंद हो जाएंगी — WhatsApp विंडो खत्म होने से पहले जवाब दें।`,
    ctaLabel: 'Inbox खोलें',
  }),
  'hot-leads-quiet': (n) => ({
    message:
      n === 1
        ? '1 हॉट लीड को 2+ दिन से आपका संदेश नहीं मिला। एक छोटा संदेश उन्हें जोड़े रखेगा!'
        : `${n} हॉट लीड्स को 2+ दिन से आपका संदेश नहीं मिला। एक छोटा संदेश उन्हें जोड़े रखेगा!`,
    ctaLabel: 'लीड्स देखें',
  }),
  'journeys-stalled': (n) => ({
    message:
      n === 1
        ? '1 प्रॉपर्टी एक हफ्ते से एक ही जर्नी स्टेज पर रुकी है। खरीदार से पूछें कि क्या वह अभी भी रुचि रखते हैं।'
        : `${n} प्रॉपर्टी एक हफ्ते से एक ही जर्नी स्टेज पर रुकी हैं। खरीदारों से पूछें कि क्या वे अभी भी रुचि रखते हैं।`,
    ctaLabel: 'Journey खोलें',
  }),
  'radar-matches': (n) => ({
    message:
      n === 1
        ? 'आपके लिए 1 नया खरीदार–प्रॉपर्टी मैच मिला। देखिए!'
        : `आपके लिए ${n} नए खरीदार–प्रॉपर्टी मैच मिले। देखिए!`,
    ctaLabel: 'Match Radar खोलें',
  }),
  'pulse-weekly-views': (n) => ({
    message: `क्या आप जानते हैं? इस हफ्ते आपकी प्रॉपर्टीज़ को ${n} व्यूज़ मिले \u{1F440}`,
    ctaLabel: 'दिखाएँ',
  }),
  'setup-whatsapp': () => ({
    message: 'ग्राहक चैट और ब्रॉडकास्ट शुरू करने के लिए WhatsApp जोड़ें।',
    ctaLabel: 'सेट करें',
  }),
  'setup-property': () => ({
    message: 'अपनी पहली प्रॉपर्टी जोड़ें — बस एक मिनट लगता है।',
    ctaLabel: 'कैसे करें, दिखाएँ',
  }),
  'setup-contact': () => ({
    message: 'अपना पहला कॉन्टैक्ट जोड़ें — बस एक मिनट लगता है।',
    ctaLabel: 'कैसे करें, दिखाएँ',
  }),
  'setup-email-leads': () => ({
    message:
      '99acres, MagicBricks या Housing से लीड्स मिलती हैं? उन्हें फॉरवर्ड करें और वे अपने आप WhatsApp कॉन्टैक्ट बन जाएँगी।',
    ctaLabel: 'कैसे करें, दिखाएँ',
  }),
  'setup-showcase-brand': () => ({
    message:
      'आपके प्रॉपर्टी लिंक अभी भी डिफ़ॉल्ट ब्रांडिंग दिखाते हैं। हर शेयर किए गए पेज पर अपना नाम लगाएँ — दो मिनट का काम है।',
    ctaLabel: 'मेरे पेज ब्रांड करें',
  }),
};

const COPY: Partial<Record<LanguageCode, Record<NudgeId, Writer>>> = {
  en: EN,
  hi: HI,
};

export function nudgeCopy(
  id: NudgeId,
  count: number,
  language: LanguageCode = 'en'
): NudgeCopy {
  return (COPY[language] ?? EN)[id](count);
}

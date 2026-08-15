// ============================================================
// Every word the Engine's own templates put in front of a client,
// in every language it can send them.
//
// One module rather than translations scattered across the seven
// template builders, for two reasons:
//
//   1. A native speaker reviewing this copy reads one file top to
//      bottom instead of hunting through seven. Given the review gate
//      on submission, that is the difference between a reviewable
//      change and a theoretically reviewable one.
//
//   2. Inbound button taps have to be matched BACK to an action.
//      A lead who taps a Kannada "ವಿಚಾರಣೆ ಮುಚ್ಚಿ" is closing their
//      enquiry exactly as one who taps "Close my enquiry" — and the
//      matcher can only know that if every label lives in one place
//      it can scan. Before this, both matchers compared against
//      hardcoded English, so a translated button would have returned
//      null and the lead would have got silence.
//
// THE COPY BELOW HAS NOT BEEN REVIEWED BY NATIVE SPEAKERS. It is a
// first pass, and the submit path deliberately refuses to send an
// unreviewed translation to Meta — see translation-review.ts. Fix the
// wording here, not in the database, so every account benefits.
//
// Meta's hard limits, enforced by template-copy.test.ts:
//   - button text     ≤ 25 characters
//   - body text       ≤ 1024 characters
//   - footer text     ≤ 60 characters
//   - a translation must carry exactly the placeholders English does,
//     or the send fails on a param-count mismatch.
// ============================================================

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  type LanguageCode,
} from '@/lib/languages';

// ------------------------------------------------------------
// Buttons
// ------------------------------------------------------------

/**
 * What a button MEANS, independent of its wording. Quick replies come
 * back to us as inbound text and must route to a handler; URL buttons
 * only ever render.
 */
export type TemplateButtonAction =
  // Quick replies — matched on the way back in.
  | 'send_more_details'
  | 'inventory_full_list'
  | 'site_visit'
  | 'update_preferences'
  | 'close_enquiry'
  | 'still_considering'
  | 'timeline_today'
  | 'timeline_2_days'
  | 'timeline_unsure'
  | 'send_options'
  // URL buttons — display only.
  | 'view_full_details'
  | 'view_location'
  | 'browse_showcase';

type Localised = Record<LanguageCode, string>;

const BUTTON_LABELS: Record<TemplateButtonAction, Localised> = {
  send_more_details: {
    en: 'Send more details',
    hi: 'और जानकारी भेजें',
    kn: 'ಹೆಚ್ಚಿನ ವಿವರ ಕಳುಹಿಸಿ',
    ta: 'மேலும் விவரம்',
    te: 'మరిన్ని వివరాలు',
    ml: 'കൂടുതൽ വിവരം',
    mr: 'अधिक माहिती पाठवा',
  },
  inventory_full_list: {
    en: 'Send full list',
    hi: 'पूरी सूची भेजें',
    kn: 'ಪೂರ್ಣ ಪಟ್ಟಿ ಕಳುಹಿಸಿ',
    ta: 'முழு பட்டியல்',
    te: 'పూర్తి జాబితా',
    ml: 'പൂർണ്ണ പട്ടിക',
    mr: 'संपूर्ण यादी पाठवा',
  },
  site_visit: {
    en: 'Book a site visit',
    hi: 'साइट विज़िट बुक करें',
    kn: 'ಸೈಟ್ ಭೇಟಿ ಬುಕ್ ಮಾಡಿ',
    ta: 'தள வருகை பதிவு',
    te: 'సైట్ విజిట్ బుక్',
    ml: 'സൈറ്റ് സന്ദർശനം',
    mr: 'साइट भेट बुक करा',
  },
  update_preferences: {
    en: 'Update my preferences',
    hi: 'पसंद अपडेट करें',
    kn: 'ಆದ್ಯತೆ ನವೀಕರಿಸಿ',
    ta: 'விருப்பம் புதுப்பி',
    te: 'ప్రాధాన్యత మార్చు',
    ml: 'മുൻഗണന പുതുക്കുക',
    mr: 'पसंती अपडेट करा',
  },
  close_enquiry: {
    en: 'Close my enquiry',
    hi: 'पूछताछ बंद करें',
    kn: 'ವಿಚಾರಣೆ ಮುಚ್ಚಿ',
    ta: 'விசாரணையை மூடு',
    te: 'విచారణ మూసివేయి',
    ml: 'അന്വേഷണം അവസാനിപ്പിക്കൂ',
    mr: 'चौकशी बंद करा',
  },
  still_considering: {
    en: 'Still considering it',
    hi: 'अभी विचार कर रहा हूँ',
    kn: 'ಇನ್ನೂ ಪರಿಶೀಲಿಸುತ್ತಿದೆ',
    ta: 'இன்னும் பரிசீலனை',
    te: 'ఇంకా పరిశీలిస్తున్నా',
    ml: 'ഇപ്പോഴും പരിഗണനയിൽ',
    mr: 'अजून विचार करत आहे',
  },
  timeline_today: {
    en: 'Today itself',
    hi: 'आज ही',
    kn: 'ಇಂದೇ',
    ta: 'இன்றே',
    te: 'ఈరోజే',
    ml: 'ഇന്നുതന്നെ',
    mr: 'आजच',
  },
  timeline_2_days: {
    en: 'In 2 days',
    hi: '2 दिन में',
    kn: '2 ದಿನಗಳಲ್ಲಿ',
    ta: '2 நாட்களில்',
    te: '2 రోజుల్లో',
    ml: '2 ദിവസത്തിനുള്ളിൽ',
    mr: '2 दिवसांत',
  },
  send_options: {
    en: 'Yes, send them',
    hi: 'हाँ, भेजें',
    kn: 'ಹೌದು, ಕಳುಹಿಸಿ',
    ta: 'ஆம், அனுப்புங்கள்',
    te: 'అవును, పంపండి',
    ml: 'അതെ, അയയ്ക്കൂ',
    mr: 'हो, पाठवा',
  },
  timeline_unsure: {
    en: "Can't say yet",
    hi: 'अभी कह नहीं सकते',
    kn: 'ಈಗ ಹೇಳಲಾಗದು',
    ta: 'இப்போது சொல்ல முடியாது',
    te: 'ఇప్పుడే చెప్పలేను',
    ml: 'ഇപ്പോൾ പറയാനാകില്ല',
    mr: 'आत्ता सांगू शकत नाही',
  },
  view_full_details: {
    en: 'View full details',
    hi: 'पूरा विवरण देखें',
    kn: 'ಪೂರ್ಣ ವಿವರ ನೋಡಿ',
    ta: 'முழு விவரம் காண்க',
    te: 'పూర్తి వివరాలు చూడు',
    ml: 'പൂർണ്ണ വിവരം കാണുക',
    mr: 'संपूर्ण तपशील पहा',
  },
  view_location: {
    en: 'View location',
    hi: 'स्थान देखें',
    kn: 'ಸ್ಥಳ ನೋಡಿ',
    ta: 'இடத்தைக் காண்க',
    te: 'స్థానం చూడండి',
    ml: 'സ്ഥലം കാണുക',
    mr: 'ठिकाण पहा',
  },
  browse_showcase: {
    en: 'Browse showcase',
    hi: 'कैटलॉग देखें',
    kn: 'ಕ್ಯಾಟಲಾಗ್ ನೋಡಿ',
    ta: 'பட்டியலைக் காண்க',
    te: 'కేటలాగ్ చూడండి',
    ml: 'കാറ്റലോഗ് കാണുക',
    mr: 'कॅटलॉग पहा',
  },
};

export function templateButtonLabel(
  action: TemplateButtonAction,
  language: LanguageCode = DEFAULT_LANGUAGE
): string {
  return BUTTON_LABELS[action][language] ?? BUTTON_LABELS[action].en;
}

/**
 * Which action an inbound button tap (or typed message) is, in ANY
 * language we send.
 *
 * Scans every language rather than the recipient's, on purpose: the
 * contact's preferred_language can be changed between the send and
 * the reply, and a lead who taps a button must be understood by the
 * words on the button they actually received.
 */
export function matchTemplateButton(
  text: string | null | undefined
): TemplateButtonAction | null {
  if (!text) return null;
  const cleaned = text.trim().toLowerCase();
  // The longest label plus slack. Guards against treating a whole
  // paragraph that happens to contain a label as a button tap.
  if (!cleaned || cleaned.length > 40) return null;

  for (const [action, labels] of Object.entries(BUTTON_LABELS)) {
    for (const code of LANGUAGE_CODES) {
      if (labels[code]?.toLowerCase() === cleaned) {
        return action as TemplateButtonAction;
      }
    }
  }
  return null;
}

// ------------------------------------------------------------
// Bodies
// ------------------------------------------------------------

export type EngineTemplateKey =
  | 'property_alert'
  | 'property_enquiry_photos'
  | 'location_reveal'
  | 'inventory_update'
  | 'enquiry_followup'
  | 'enquiry_notice'
  | 'journey_checkin'
  | 'journey_timeline'
  | 'journey_followup_reminder'
  | 'audio_announcement'
  | 'post_call_options';

interface TemplateCopy {
  body: string;
  footer?: string;
}

const lines = (...l: string[]) => l.join('\n');

/**
 * Per-template copy. English is the source of truth; a language with
 * no entry falls back to it, so a half-translated template still
 * sends rather than sending a blank.
 *
 * The enquiry-family wording is deliberately flat and transactional in
 * every language — labelled fields, no emoji, no persuasive CTA. That
 * is what keeps them classified Utility rather than Marketing (see
 * AGENTS.md §2.7); a translation that adds warmth or urgency would
 * re-categorise the template on review and there is no undoing that.
 */
const TEMPLATE_COPY: Record<
  EngineTemplateKey,
  Partial<Record<LanguageCode, TemplateCopy>>
> = {
  property_alert: {
    en: {
      body: lines(
        'Hi {{1}}, here are the details for your property enquiry with {{2}}:',
        '',
        'Property: {{3}}',
        'Details: {{4}}',
        'Location: {{5}}',
        '',
        'Reply to this message if you need any further information about this enquiry.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ का विवरण {{2}} की ओर से नीचे दिया है:',
        '',
        'प्रॉपर्टी: {{3}}',
        'विवरण: {{4}}',
        'स्थान: {{5}}',
        '',
        'इस पूछताछ के बारे में और जानकारी चाहिए तो इस संदेश का उत्तर दें।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಯ ವಿವರಗಳು {{2}} ಕಡೆಯಿಂದ ಇಲ್ಲಿವೆ:',
        '',
        'ಆಸ್ತಿ: {{3}}',
        'ವಿವರಗಳು: {{4}}',
        'ಸ್ಥಳ: {{5}}',
        '',
        'ಈ ವಿಚಾರಣೆಯ ಬಗ್ಗೆ ಹೆಚ್ಚಿನ ಮಾಹಿತಿ ಬೇಕಿದ್ದರೆ ಈ ಸಂದೇಶಕ್ಕೆ ಉತ್ತರಿಸಿ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணையின் விவரங்கள் {{2}} சார்பாக:',
        '',
        'சொத்து: {{3}}',
        'விவரங்கள்: {{4}}',
        'இடம்: {{5}}',
        '',
        'இந்த விசாரணை குறித்து மேலும் தகவல் தேவைப்பட்டால் இந்தச் செய்திக்கு பதிலளிக்கவும்.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణ వివరాలు {{2}} తరఫున ఇవి:',
        '',
        'ఆస్తి: {{3}}',
        'వివరాలు: {{4}}',
        'స్థానం: {{5}}',
        '',
        'ఈ విచారణ గురించి మరింత సమాచారం కావాలంటే ఈ సందేశానికి బదులివ్వండి.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണത്തിന്റെ വിവരങ്ങൾ {{2}} നൽകുന്നു:',
        '',
        'വസ്തു: {{3}}',
        'വിവരങ്ങൾ: {{4}}',
        'സ്ഥലം: {{5}}',
        '',
        'ഈ അന്വേഷണത്തെക്കുറിച്ച് കൂടുതൽ വിവരം വേണമെങ്കിൽ ഈ സന്ദേശത്തിന് മറുപടി നൽകുക.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीचे तपशील {{2}} कडून:',
        '',
        'मालमत्ता: {{3}}',
        'तपशील: {{4}}',
        'ठिकाण: {{5}}',
        '',
        'या चौकशीबद्दल अधिक माहिती हवी असल्यास या संदेशाला उत्तर द्या.'
      ),
    },
  },

  property_enquiry_photos: {
    en: {
      body: lines(
        'Hi {{1}}, sharing the photos you requested for your property enquiry with {{2}}:',
        '',
        'Property: {{3}}',
        'Details: {{4}}',
        'Location: {{5}}',
        '',
        'Reply to this message if you need any further information about this enquiry.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ के लिए माँगी गई तस्वीरें {{2}} की ओर से भेज रहे हैं:',
        '',
        'प्रॉपर्टी: {{3}}',
        'विवरण: {{4}}',
        'स्थान: {{5}}',
        '',
        'इस पूछताछ के बारे में और जानकारी चाहिए तो इस संदेश का उत्तर दें।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಗಾಗಿ ಕೇಳಿದ ಫೋಟೋಗಳನ್ನು {{2}} ಕಡೆಯಿಂದ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ:',
        '',
        'ಆಸ್ತಿ: {{3}}',
        'ವಿವರಗಳು: {{4}}',
        'ಸ್ಥಳ: {{5}}',
        '',
        'ಈ ವಿಚಾರಣೆಯ ಬಗ್ಗೆ ಹೆಚ್ಚಿನ ಮಾಹಿತಿ ಬೇಕಿದ್ದರೆ ಈ ಸಂದೇಶಕ್ಕೆ ಉತ್ತರಿಸಿ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணைக்காக நீங்கள் கேட்ட புகைப்படங்கள் {{2}} சார்பாக:',
        '',
        'சொத்து: {{3}}',
        'விவரங்கள்: {{4}}',
        'இடம்: {{5}}',
        '',
        'இந்த விசாரணை குறித்து மேலும் தகவல் தேவைப்பட்டால் இந்தச் செய்திக்கு பதிலளிக்கவும்.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణ కోసం మీరు అడిగిన ఫోటోలు {{2}} తరఫున:',
        '',
        'ఆస్తి: {{3}}',
        'వివరాలు: {{4}}',
        'స్థానం: {{5}}',
        '',
        'ఈ విచారణ గురించి మరింత సమాచారం కావాలంటే ఈ సందేశానికి బదులివ్వండి.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണത്തിനായി ആവശ്യപ്പെട്ട ചിത്രങ്ങൾ {{2}} അയയ്ക്കുന്നു:',
        '',
        'വസ്തു: {{3}}',
        'വിവരങ്ങൾ: {{4}}',
        'സ്ഥലം: {{5}}',
        '',
        'ഈ അന്വേഷണത്തെക്കുറിച്ച് കൂടുതൽ വിവരം വേണമെങ്കിൽ ഈ സന്ദേശത്തിന് മറുപടി നൽകുക.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीसाठी मागवलेले फोटो {{2}} कडून पाठवत आहोत:',
        '',
        'मालमत्ता: {{3}}',
        'तपशील: {{4}}',
        'ठिकाण: {{5}}',
        '',
        'या चौकशीबद्दल अधिक माहिती हवी असल्यास या संदेशाला उत्तर द्या.'
      ),
    },
  },

  location_reveal: {
    en: {
      body: lines(
        '📍 *Location Request Approved*',
        '',
        'Hi {{1}}, your request for the exact location of {{2}} has been approved by the listing team.',
        '',
        'Tap the button below to view the address, map pin and full photos. The link stays valid for 48 hours.'
      ),
    },
    hi: {
      body: lines(
        '📍 *स्थान अनुरोध स्वीकृत*',
        '',
        'नमस्ते {{1}}, आपने जिस प्रॉपर्टी का सटीक स्थान माँगा था — {{2}} — उसे लिस्टिंग टीम ने स्वीकृत कर दिया है।',
        '',
        'पता, मैप पिन और सभी तस्वीरें देखने के लिए नीचे दिए बटन पर टैप करें। यह लिंक 48 घंटे तक वैध रहेगा।'
      ),
    },
    kn: {
      body: lines(
        '📍 *ಸ್ಥಳ ವಿನಂತಿ ಅನುಮೋದನೆಗೊಂಡಿದೆ*',
        '',
        'ನಮಸ್ಕಾರ {{1}}, ನೀವು ನಿಖರ ಸ್ಥಳ ಕೇಳಿದ ಆಸ್ತಿ — {{2}} — ಅನ್ನು ಲಿಸ್ಟಿಂಗ್ ತಂಡ ಅನುಮೋದಿಸಿದೆ.',
        '',
        'ವಿಳಾಸ, ನಕ್ಷೆ ಮತ್ತು ಎಲ್ಲ ಫೋಟೋಗಳನ್ನು ನೋಡಲು ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ. ಈ ಲಿಂಕ್ 48 ಗಂಟೆ ಮಾನ್ಯವಾಗಿರುತ್ತದೆ.'
      ),
    },
    ta: {
      body: lines(
        '📍 *இட கோரிக்கை அங்கீகரிக்கப்பட்டது*',
        '',
        'வணக்கம் {{1}}, நீங்கள் சரியான இடம் கேட்ட சொத்து — {{2}} — பட்டியல் குழுவால் அங்கீகரிக்கப்பட்டது.',
        '',
        'முகவரி, வரைபடம் மற்றும் அனைத்து புகைப்படங்களையும் காண கீழே உள்ள பொத்தானை அழுத்தவும். இந்த இணைப்பு 48 மணி நேரம் செல்லுபடியாகும்.'
      ),
    },
    te: {
      body: lines(
        '📍 *స్థాన అభ్యర్థన ఆమోదించబడింది*',
        '',
        'నమస్కారం {{1}}, మీరు ఖచ్చితమైన స్థానం అడిగిన ఆస్తి — {{2}} — లిస్టింగ్ బృందం ఆమోదించింది.',
        '',
        'చిరునామా, మ్యాప్ మరియు అన్ని ఫోటోలు చూడటానికి కింది బటన్ నొక్కండి. ఈ లింక్ 48 గంటలు చెల్లుబాటు అవుతుంది.'
      ),
    },
    ml: {
      body: lines(
        '📍 *സ്ഥല അഭ്യർത്ഥന അംഗീകരിച്ചു*',
        '',
        'നമസ്കാരം {{1}}, നിങ്ങൾ കൃത്യമായ സ്ഥാനം ആവശ്യപ്പെട്ട വസ്തു — {{2}} — ലിസ്റ്റിംഗ് ടീം അംഗീകരിച്ചു.',
        '',
        'വിലാസം, മാപ്പ്, എല്ലാ ചിത്രങ്ങളും കാണാൻ താഴെയുള്ള ബട്ടൺ അമർത്തുക. ഈ ലിങ്ക് 48 മണിക്കൂർ സാധുവാണ്.'
      ),
    },
    mr: {
      body: lines(
        '📍 *ठिकाण विनंती मंजूर*',
        '',
        'नमस्कार {{1}}, तुम्ही अचूक ठिकाण मागितलेली मालमत्ता — {{2}} — लिस्टिंग टीमने मंजूर केली आहे.',
        '',
        'पत्ता, नकाशा आणि सर्व फोटो पाहण्यासाठी खालील बटण दाबा. ही लिंक 48 तास वैध राहील.'
      ),
    },
  },

  inventory_update: {
    en: {
      body: lines(
        '🏠 *New Inventory Update*',
        '',
        "Hi {{1}}! We've just refreshed our property catalog. Quick snapshot:",
        '',
        '🏡 Residential: {{2}}',
        '',
        '🏢 Commercial: {{3}}',
        '',
        '🌾 Farm & land: {{4}}',
        '',
        'Reply to this message for photos, exact locations, or to book a site visit — I answer personally on this number.'
      ),
      footer: 'Reply STOP to unsubscribe',
    },
    hi: {
      body: lines(
        '🏠 *नई इन्वेंटरी अपडेट*',
        '',
        'नमस्ते {{1}}! हमने अभी अपना प्रॉपर्टी कैटलॉग अपडेट किया है। एक झलक:',
        '',
        '🏡 रिहायशी: {{2}}',
        '',
        '🏢 व्यावसायिक: {{3}}',
        '',
        '🌾 खेत और ज़मीन: {{4}}',
        '',
        'तस्वीरें, सटीक स्थान या साइट विज़िट बुक करने के लिए इस संदेश का उत्तर दें — मैं इसी नंबर पर खुद जवाब देता हूँ।'
      ),
      footer: 'बंद करने के लिए STOP भेजें',
    },
    kn: {
      body: lines(
        '🏠 *ಹೊಸ ಆಸ್ತಿ ಪಟ್ಟಿ ಅಪ್‌ಡೇಟ್*',
        '',
        'ನಮಸ್ಕಾರ {{1}}! ನಾವು ನಮ್ಮ ಆಸ್ತಿ ಪಟ್ಟಿಯನ್ನು ನವೀಕರಿಸಿದ್ದೇವೆ. ಒಂದು ನೋಟ:',
        '',
        '🏡 ವಸತಿ: {{2}}',
        '',
        '🏢 ವಾಣಿಜ್ಯ: {{3}}',
        '',
        '🌾 ಕೃಷಿ ಮತ್ತು ಭೂಮಿ: {{4}}',
        '',
        'ಫೋಟೋಗಳು, ನಿಖರ ಸ್ಥಳ ಅಥವಾ ಸೈಟ್ ಭೇಟಿಗಾಗಿ ಈ ಸಂದೇಶಕ್ಕೆ ಉತ್ತರಿಸಿ — ನಾನೇ ಈ ಸಂಖ್ಯೆಯಲ್ಲಿ ಉತ್ತರಿಸುತ್ತೇನೆ.'
      ),
      footer: 'ನಿಲ್ಲಿಸಲು STOP ಕಳುಹಿಸಿ',
    },
    ta: {
      body: lines(
        '🏠 *புதிய பட்டியல் புதுப்பிப்பு*',
        '',
        'வணக்கம் {{1}}! எங்கள் சொத்துப் பட்டியலைப் புதுப்பித்துள்ளோம். ஒரு பார்வை:',
        '',
        '🏡 குடியிருப்பு: {{2}}',
        '',
        '🏢 வணிகம்: {{3}}',
        '',
        '🌾 பண்ணை மற்றும் நிலம்: {{4}}',
        '',
        'புகைப்படங்கள், சரியான இடம் அல்லது தள வருகைக்கு இந்தச் செய்திக்கு பதிலளிக்கவும் — இதே எண்ணில் நானே பதிலளிக்கிறேன்.'
      ),
      footer: 'நிறுத்த STOP அனுப்பவும்',
    },
    te: {
      body: lines(
        '🏠 *కొత్త ఆస్తుల జాబితా అప్‌డేట్*',
        '',
        'నమస్కారం {{1}}! మా ఆస్తుల జాబితాను తాజాగా నవీకరించాము. ఒక సంక్షిప్త వివరం:',
        '',
        '🏡 నివాస: {{2}}',
        '',
        '🏢 వాణిజ్య: {{3}}',
        '',
        '🌾 వ్యవసాయం మరియు భూమి: {{4}}',
        '',
        'ఫోటోలు, ఖచ్చితమైన స్థానం లేదా సైట్ విజిట్ కోసం ఈ సందేశానికి బదులివ్వండి — ఇదే నంబర్‌లో నేనే స్వయంగా బదులిస్తాను.'
      ),
      footer: 'ఆపడానికి STOP పంపండి',
    },
    ml: {
      body: lines(
        '🏠 *പുതിയ പ്രോപ്പർട്ടി അപ്‌ഡേറ്റ്*',
        '',
        'നമസ്കാരം {{1}}! ഞങ്ങളുടെ പ്രോപ്പർട്ടി പട്ടിക പുതുക്കിയിട്ടുണ്ട്. ഒരു ചെറു വിവരണം:',
        '',
        '🏡 വാസയോഗ്യം: {{2}}',
        '',
        '🏢 വാണിജ്യം: {{3}}',
        '',
        '🌾 കൃഷിയും ഭൂമിയും: {{4}}',
        '',
        'ചിത്രങ്ങൾ, കൃത്യമായ സ്ഥാനം അല്ലെങ്കിൽ സൈറ്റ് സന്ദർശനത്തിന് ഈ സന്ദേശത്തിന് മറുപടി നൽകുക — ഈ നമ്പറിൽ ഞാൻ തന്നെ മറുപടി നൽകും.'
      ),
      footer: 'നിർത്താൻ STOP അയയ്ക്കുക',
    },
    mr: {
      body: lines(
        '🏠 *नवीन मालमत्ता अपडेट*',
        '',
        'नमस्कार {{1}}! आम्ही आमची मालमत्ता यादी नुकतीच अद्ययावत केली आहे. एक झलक:',
        '',
        '🏡 निवासी: {{2}}',
        '',
        '🏢 व्यावसायिक: {{3}}',
        '',
        '🌾 शेती आणि जमीन: {{4}}',
        '',
        'फोटो, अचूक ठिकाण किंवा साइट भेटीसाठी या संदेशाला उत्तर द्या — याच नंबरवर मी स्वतः उत्तर देतो.'
      ),
      footer: 'थांबवण्यासाठी STOP पाठवा',
    },
  },

  enquiry_followup: {
    en: {
      body: lines(
        'Hi {{1}}, this is a status update on your property enquiry with {{2}}:',
        '',
        'The listing you enquired about is no longer available, so your enquiry cannot be fulfilled as filed.',
        '',
        'To keep your enquiry open, update your requirement below or reply with what you are looking for now. To end it, choose "Close my enquiry" and no further updates will be sent.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ की स्थिति {{2}} की ओर से:',
        '',
        'जिस लिस्टिंग के बारे में आपने पूछा था वह अब उपलब्ध नहीं है, इसलिए आपकी पूछताछ दर्ज रूप में पूरी नहीं की जा सकती।',
        '',
        'पूछताछ जारी रखने के लिए नीचे अपनी ज़रूरत अपडेट करें या अभी क्या चाहिए वह उत्तर में लिखें। समाप्त करने के लिए "पूछताछ बंद करें" चुनें, फिर कोई अपडेट नहीं भेजा जाएगा।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಯ ಸ್ಥಿತಿ {{2}} ಕಡೆಯಿಂದ:',
        '',
        'ನೀವು ವಿಚಾರಿಸಿದ ಆಸ್ತಿ ಈಗ ಲಭ್ಯವಿಲ್ಲ, ಆದ್ದರಿಂದ ನಿಮ್ಮ ವಿಚಾರಣೆಯನ್ನು ದಾಖಲಾದ ರೂಪದಲ್ಲಿ ಪೂರೈಸಲಾಗುವುದಿಲ್ಲ.',
        '',
        'ವಿಚಾರಣೆ ಮುಂದುವರಿಸಲು ಕೆಳಗೆ ನಿಮ್ಮ ಅಗತ್ಯವನ್ನು ನವೀಕರಿಸಿ ಅಥವಾ ಈಗ ಏನು ಬೇಕು ಎಂದು ಉತ್ತರಿಸಿ. ಮುಗಿಸಲು "ವಿಚಾರಣೆ ಮುಚ್ಚಿ" ಆಯ್ಕೆಮಾಡಿ, ನಂತರ ಯಾವುದೇ ಅಪ್‌ಡೇಟ್ ಬರುವುದಿಲ್ಲ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணையின் நிலை {{2}} சார்பாக:',
        '',
        'நீங்கள் விசாரித்த சொத்து இப்போது கிடைக்கவில்லை, எனவே உங்கள் விசாரணையை பதிவு செய்த வடிவில் நிறைவேற்ற முடியாது.',
        '',
        'விசாரணையைத் தொடர கீழே உங்கள் தேவையைப் புதுப்பிக்கவும் அல்லது இப்போது என்ன தேவை என்று பதிலளிக்கவும். முடிக்க "விசாரணையை மூடு" தேர்ந்தெடுக்கவும், பின் எந்த புதுப்பிப்பும் அனுப்பப்படாது.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణ స్థితి {{2}} తరఫున:',
        '',
        'మీరు విచారించిన ఆస్తి ఇప్పుడు అందుబాటులో లేదు, కాబట్టి మీ విచారణను నమోదైన రూపంలో పూర్తి చేయలేము.',
        '',
        'విచారణ కొనసాగించడానికి కింద మీ అవసరాన్ని నవీకరించండి లేదా ఇప్పుడు ఏమి కావాలో బదులివ్వండి. ముగించడానికి "విచారణ మూసివేయి" ఎంచుకోండి, తర్వాత ఎటువంటి అప్‌డేట్ రాదు.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണത്തിന്റെ നില {{2}} അറിയിക്കുന്നു:',
        '',
        'നിങ്ങൾ അന്വേഷിച്ച വസ്തു ഇപ്പോൾ ലഭ്യമല്ല, അതിനാൽ നിങ്ങളുടെ അന്വേഷണം രേഖപ്പെടുത്തിയ രൂപത്തിൽ പൂർത്തിയാക്കാൻ കഴിയില്ല.',
        '',
        'അന്വേഷണം തുടരാൻ താഴെ നിങ്ങളുടെ ആവശ്യം പുതുക്കുക അല്ലെങ്കിൽ ഇപ്പോൾ എന്താണ് വേണ്ടതെന്ന് മറുപടി നൽകുക. അവസാനിപ്പിക്കാൻ "അന്വേഷണം അവസാനിപ്പിക്കൂ" തിരഞ്ഞെടുക്കുക, പിന്നെ അപ്‌ഡേറ്റുകൾ വരില്ല.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीची स्थिती {{2}} कडून:',
        '',
        'तुम्ही चौकशी केलेली मालमत्ता आता उपलब्ध नाही, त्यामुळे तुमची चौकशी नोंदवलेल्या स्वरूपात पूर्ण करता येणार नाही.',
        '',
        'चौकशी सुरू ठेवण्यासाठी खाली तुमची गरज अपडेट करा किंवा आता काय हवे ते उत्तरात लिहा. संपवण्यासाठी "चौकशी बंद करा" निवडा, नंतर कोणतेही अपडेट पाठवले जाणार नाहीत.'
      ),
    },
  },

  enquiry_notice: {
    en: {
      body: lines(
        'Hi {{1}}, this is a status update on your property enquiry with {{2}}:',
        '',
        'Property: {{3}}',
        '',
        'The listing you enquired about is no longer available, so your enquiry cannot be fulfilled as filed.',
        '',
        'To keep your enquiry open, update your requirement below or reply with what you are looking for now. To end it, choose "Close my enquiry" and no further updates will be sent.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ की स्थिति {{2}} की ओर से:',
        '',
        'प्रॉपर्टी: {{3}}',
        '',
        'जिस लिस्टिंग के बारे में आपने पूछा था वह अब उपलब्ध नहीं है, इसलिए आपकी पूछताछ दर्ज रूप में पूरी नहीं की जा सकती।',
        '',
        'पूछताछ जारी रखने के लिए नीचे अपनी ज़रूरत अपडेट करें या अभी क्या चाहिए वह उत्तर में लिखें। समाप्त करने के लिए "पूछताछ बंद करें" चुनें, फिर कोई अपडेट नहीं भेजा जाएगा।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಯ ಸ್ಥಿತಿ {{2}} ಕಡೆಯಿಂದ:',
        '',
        'ಆಸ್ತಿ: {{3}}',
        '',
        'ನೀವು ವಿಚಾರಿಸಿದ ಆಸ್ತಿ ಈಗ ಲಭ್ಯವಿಲ್ಲ, ಆದ್ದರಿಂದ ನಿಮ್ಮ ವಿಚಾರಣೆಯನ್ನು ದಾಖಲಾದ ರೂಪದಲ್ಲಿ ಪೂರೈಸಲಾಗುವುದಿಲ್ಲ.',
        '',
        'ವಿಚಾರಣೆ ಮುಂದುವರಿಸಲು ಕೆಳಗೆ ನಿಮ್ಮ ಅಗತ್ಯವನ್ನು ನವೀಕರಿಸಿ ಅಥವಾ ಈಗ ಏನು ಬೇಕು ಎಂದು ಉತ್ತರಿಸಿ. ಮುಗಿಸಲು "ವಿಚಾರಣೆ ಮುಚ್ಚಿ" ಆಯ್ಕೆಮಾಡಿ, ನಂತರ ಯಾವುದೇ ಅಪ್‌ಡೇಟ್ ಬರುವುದಿಲ್ಲ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணையின் நிலை {{2}} சார்பாக:',
        '',
        'சொத்து: {{3}}',
        '',
        'நீங்கள் விசாரித்த சொத்து இப்போது கிடைக்கவில்லை, எனவே உங்கள் விசாரணையை பதிவு செய்த வடிவில் நிறைவேற்ற முடியாது.',
        '',
        'விசாரணையைத் தொடர கீழே உங்கள் தேவையைப் புதுப்பிக்கவும் அல்லது இப்போது என்ன தேவை என்று பதிலளிக்கவும். முடிக்க "விசாரணையை மூடு" தேர்ந்தெடுக்கவும், பின் எந்த புதுப்பிப்பும் அனுப்பப்படாது.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణ స్థితి {{2}} తరఫున:',
        '',
        'ఆస్తి: {{3}}',
        '',
        'మీరు విచారించిన ఆస్తి ఇప్పుడు అందుబాటులో లేదు, కాబట్టి మీ విచారణను నమోదైన రూపంలో పూర్తి చేయలేము.',
        '',
        'విచారణ కొనసాగించడానికి కింద మీ అవసరాన్ని నవీకరించండి లేదా ఇప్పుడు ఏమి కావాలో బదులివ్వండి. ముగించడానికి "విచారణ మూసివేయి" ఎంచుకోండి, తర్వాత ఎటువంటి అప్‌డేట్ రాదు.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണത്തിന്റെ നില {{2}} അറിയിക്കുന്നു:',
        '',
        'വസ്തു: {{3}}',
        '',
        'നിങ്ങൾ അന്വേഷിച്ച വസ്തു ഇപ്പോൾ ലഭ്യമല്ല, അതിനാൽ നിങ്ങളുടെ അന്വേഷണം രേഖപ്പെടുത്തിയ രൂപത്തിൽ പൂർത്തിയാക്കാൻ കഴിയില്ല.',
        '',
        'അന്വേഷണം തുടരാൻ താഴെ നിങ്ങളുടെ ആവശ്യം പുതുക്കുക അല്ലെങ്കിൽ ഇപ്പോൾ എന്താണ് വേണ്ടതെന്ന് മറുപടി നൽകുക. അവസാനിപ്പിക്കാൻ "അന്വേഷണം അവസാനിപ്പിക്കൂ" തിരഞ്ഞെടുക്കുക, പിന്നെ അപ്‌ഡേറ്റുകൾ വരില്ല.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीची स्थिती {{2}} कडून:',
        '',
        'मालमत्ता: {{3}}',
        '',
        'तुम्ही चौकशी केलेली मालमत्ता आता उपलब्ध नाही, त्यामुळे तुमची चौकशी नोंदवलेल्या स्वरूपात पूर्ण करता येणार नाही.',
        '',
        'चौकशी सुरू ठेवण्यासाठी खाली तुमची गरज अपडेट करा किंवा आता काय हवे ते उत्तरात लिहा. संपवण्यासाठी "चौकशी बंद करा" निवडा, नंतर कोणतेही अपडेट पाठवले जाणार नाहीत.'
      ),
    },
  },

  journey_checkin: {
    en: {
      body: lines(
        'Hi {{1}}, this is a check-in on your property enquiry with {{2}}:',
        '',
        'Property: {{3}}',
        '',
        'We have had no update from you on this listing, so your enquiry is still open against it.',
        '',
        'Reply to confirm it is still under consideration. To end the enquiry, choose "Close my enquiry" and no further updates will be sent.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ पर एक जाँच {{2}} की ओर से:',
        '',
        'प्रॉपर्टी: {{3}}',
        '',
        'इस लिस्टिंग पर आपकी ओर से कोई अपडेट नहीं मिला, इसलिए आपकी पूछताछ अब भी खुली है।',
        '',
        'यदि यह अब भी विचाराधीन है तो उत्तर देकर पुष्टि करें। पूछताछ समाप्त करने के लिए "पूछताछ बंद करें" चुनें, फिर कोई अपडेट नहीं भेजा जाएगा।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಯ ಕುರಿತು ಒಂದು ಪರಿಶೀಲನೆ {{2}} ಕಡೆಯಿಂದ:',
        '',
        'ಆಸ್ತಿ: {{3}}',
        '',
        'ಈ ಆಸ್ತಿಯ ಬಗ್ಗೆ ನಿಮ್ಮಿಂದ ಯಾವುದೇ ಮಾಹಿತಿ ಬಂದಿಲ್ಲ, ಆದ್ದರಿಂದ ನಿಮ್ಮ ವಿಚಾರಣೆ ಇನ್ನೂ ತೆರೆದಿದೆ.',
        '',
        'ಇದು ಇನ್ನೂ ಪರಿಶೀಲನೆಯಲ್ಲಿದ್ದರೆ ಉತ್ತರಿಸಿ ದೃಢಪಡಿಸಿ. ವಿಚಾರಣೆ ಮುಗಿಸಲು "ವಿಚಾರಣೆ ಮುಚ್ಚಿ" ಆಯ್ಕೆಮಾಡಿ, ನಂತರ ಯಾವುದೇ ಅಪ್‌ಡೇಟ್ ಬರುವುದಿಲ್ಲ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணை குறித்த ஒரு பரிசீலனை {{2}} சார்பாக:',
        '',
        'சொத்து: {{3}}',
        '',
        'இந்தச் சொத்து குறித்து உங்களிடமிருந்து எந்தத் தகவலும் வரவில்லை, எனவே உங்கள் விசாரணை இன்னும் திறந்தே உள்ளது.',
        '',
        'இது இன்னும் பரிசீலனையில் இருந்தால் பதிலளித்து உறுதிப்படுத்தவும். விசாரணையை முடிக்க "விசாரணையை மூடு" தேர்ந்தெடுக்கவும், பின் எந்த புதுப்பிப்பும் அனுப்பப்படாது.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణపై ఒక సమీక్ష {{2}} తరఫున:',
        '',
        'ఆస్తి: {{3}}',
        '',
        'ఈ ఆస్తి గురించి మీ నుండి ఎటువంటి సమాచారం రాలేదు, కాబట్టి మీ విచారణ ఇంకా తెరిచే ఉంది.',
        '',
        'ఇది ఇంకా పరిశీలనలో ఉంటే బదులిచ్చి నిర్ధారించండి. విచారణ ముగించడానికి "విచారణ మూసివేయి" ఎంచుకోండి, తర్వాత ఎటువంటి అప్‌డేట్ రాదు.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണത്തെക്കുറിച്ച് ഒരു അന്വേഷണം {{2}} നടത്തുന്നു:',
        '',
        'വസ്തു: {{3}}',
        '',
        'ഈ വസ്തുവിനെക്കുറിച്ച് നിങ്ങളിൽ നിന്ന് വിവരമൊന്നും ലഭിച്ചിട്ടില്ല, അതിനാൽ നിങ്ങളുടെ അന്വേഷണം ഇപ്പോഴും തുറന്നിരിക്കുന്നു.',
        '',
        'ഇത് ഇപ്പോഴും പരിഗണനയിലാണെങ്കിൽ മറുപടി നൽകി സ്ഥിരീകരിക്കുക. അന്വേഷണം അവസാനിപ്പിക്കാൻ "അന്വേഷണം അവസാനിപ്പിക്കൂ" തിരഞ്ഞെടുക്കുക, പിന്നെ അപ്‌ഡേറ്റുകൾ വരില്ല.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीबाबत एक विचारणा {{2}} कडून:',
        '',
        'मालमत्ता: {{3}}',
        '',
        'या मालमत्तेबाबत तुमच्याकडून कोणतीही माहिती आलेली नाही, त्यामुळे तुमची चौकशी अजूनही खुली आहे.',
        '',
        'हे अजूनही विचाराधीन असल्यास उत्तर देऊन खात्री करा. चौकशी संपवण्यासाठी "चौकशी बंद करा" निवडा, नंतर कोणतेही अपडेट पाठवले जाणार नाहीत.'
      ),
    },
  },

  // Asks the lead to schedule the next contact, after they have said
  // they would come back with a decision.
  //
  // SUBMITTED AND CAME BACK MARKETING. Kept because the approved row
  // still sends (pick-approved-template prefers the Utility row under
  // journey_followup_reminder below and only falls back here), and
  // because the wording is the record of what does NOT earn Utility:
  // it describes outreach we intend to make rather than a dated item
  // on the lead's own record. Do not reuse this shape.
  journey_timeline: {
    en: {
      body: lines(
        'Hi {{1}}, an update on your property enquiry with {{2}}:',
        '',
        'Property: {{3}}',
        '',
        'You told us you would come back to us with your decision on this listing.',
        '',
        'Please choose when we should check back, so we do not follow up sooner than you need.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ पर {{2}} की ओर से एक अपडेट:',
        '',
        'प्रॉपर्टी: {{3}}',
        '',
        'आपने बताया था कि आप इस लिस्टिंग पर अपना निर्णय बताएंगे।',
        '',
        'कृपया चुनें कि हम कब दोबारा संपर्क करें, ताकि आपकी ज़रूरत से पहले संपर्क न करें।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಯ ಕುರಿತು {{2}} ಕಡೆಯಿಂದ ಒಂದು ಅಪ್‌ಡೇಟ್:',
        '',
        'ಆಸ್ತಿ: {{3}}',
        '',
        'ಈ ಪಟ್ಟಿಯ ಬಗ್ಗೆ ನಿಮ್ಮ ನಿರ್ಧಾರವನ್ನು ತಿಳಿಸುವುದಾಗಿ ನೀವು ಹೇಳಿದ್ದಿರಿ.',
        '',
        'ನಾವು ಯಾವಾಗ ಮತ್ತೆ ಸಂಪರ್ಕಿಸಬೇಕು ಎಂಬುದನ್ನು ಆಯ್ಕೆಮಾಡಿ, ನಿಮಗೆ ಬೇಕಾದ ಸಮಯಕ್ಕಿಂತ ಮೊದಲು ಸಂಪರ್ಕಿಸದಿರಲು.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணை குறித்து {{2}} சார்பாக ஒரு புதுப்பிப்பு:',
        '',
        'சொத்து: {{3}}',
        '',
        'இந்தப் பட்டியல் குறித்த உங்கள் முடிவைத் தெரிவிப்பதாகக் கூறியிருந்தீர்கள்.',
        '',
        'நாங்கள் எப்போது மீண்டும் தொடர்பு கொள்ள வேண்டும் என்பதைத் தேர்ந்தெடுக்கவும்.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణపై {{2}} తరఫున ఒక అప్‌డేట్:',
        '',
        'ఆస్తి: {{3}}',
        '',
        'ఈ లిస్టింగ్‌పై మీ నిర్ణయాన్ని తెలియజేస్తానని మీరు చెప్పారు.',
        '',
        'మేము ఎప్పుడు మళ్లీ సంప్రదించాలో ఎంచుకోండి, మీకు అవసరమైన సమయానికి ముందే సంప్రదించకుండా.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണം സംബന്ധിച്ച് {{2}} നൽകുന്ന ഒരു അപ്‌ഡേറ്റ്:',
        '',
        'വസ്തു: {{3}}',
        '',
        'ഈ ലിസ്റ്റിംഗിനെക്കുറിച്ചുള്ള നിങ്ങളുടെ തീരുമാനം അറിയിക്കാമെന്ന് നിങ്ങൾ പറഞ്ഞിരുന്നു.',
        '',
        'ഞങ്ങൾ എപ്പോൾ വീണ്ടും ബന്ധപ്പെടണം എന്ന് തിരഞ്ഞെടുക്കുക.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीबाबत {{2}} कडून एक अपडेट:',
        '',
        'मालमत्ता: {{3}}',
        '',
        'या नोंदीबाबत तुमचा निर्णय कळवाल असे तुम्ही सांगितले होते.',
        '',
        'आम्ही केव्हा पुन्हा संपर्क साधावा ते निवडा, तुमच्या गरजेच्या आधी संपर्क करू नये म्हणून.'
      ),
    },
  },

  // The second attempt at the same job, shaped like the four reminder
  // templates this account holds UTILITY on (appointment_reminder,
  // appointment_reminder_agenda, property_visit_reminder,
  // property_visit_reminder_agenda) rather than like the enquiry
  // family.
  //
  // What those four share, and what journey_timeline above lacked: a
  // concrete dated item that already exists on the recipient's record,
  // and buttons that confirm or move THAT item. "Please tap a button
  // below to confirm or request a change" is the exact sentence Meta
  // has approved as Utility here four times over. An open question
  // about when we may contact them is outreach; moving a scheduled
  // date on their own enquiry is administration of it.
  //
  // {{4}} is the date the follow-up is currently set for — stamped on
  // the journey item before the send, so the message states a fact
  // rather than proposing one.
  journey_followup_reminder: {
    en: {
      body: lines(
        'Hi {{1}}, this is a reminder from {{2}} that your property enquiry is open and awaiting your decision.',
        '',
        'Property: {{3}}',
        'Follow-up currently scheduled for: {{4}}',
        '',
        'Please tap a button below to confirm this date or move it. If you choose "Can\'t say yet", the follow-up is removed and your enquiry stays open until you contact us.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, यह {{2}} की ओर से याद दिलाना है कि आपकी प्रॉपर्टी पूछताछ खुली है और आपके निर्णय की प्रतीक्षा में है।',
        '',
        'प्रॉपर्टी: {{3}}',
        'अगला संपर्क निर्धारित है: {{4}}',
        '',
        'इस तारीख की पुष्टि करने या बदलने के लिए नीचे बटन दबाएं। "अभी कह नहीं सकते" चुनने पर निर्धारित संपर्क हटा दिया जाएगा और आपकी पूछताछ खुली रहेगी।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ಇದು {{2}} ಕಡೆಯಿಂದ ಜ್ಞಾಪನೆ — ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆ ತೆರೆದಿದೆ ಮತ್ತು ನಿಮ್ಮ ನಿರ್ಧಾರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿದೆ.',
        '',
        'ಆಸ್ತಿ: {{3}}',
        'ಮುಂದಿನ ಸಂಪರ್ಕ ನಿಗದಿ: {{4}}',
        '',
        'ಈ ದಿನಾಂಕವನ್ನು ದೃಢೀಕರಿಸಲು ಅಥವಾ ಬದಲಾಯಿಸಲು ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ. "ಈಗ ಹೇಳಲಾಗದು" ಆಯ್ಕೆ ಮಾಡಿದರೆ ನಿಗದಿತ ಸಂಪರ್ಕ ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ ಮತ್ತು ವಿಚಾರಣೆ ತೆರೆದಿರುತ್ತದೆ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, இது {{2}} சார்பாக ஒரு நினைவூட்டல் — உங்கள் சொத்து விசாரணை திறந்திருக்கிறது, உங்கள் முடிவுக்காக காத்திருக்கிறது.',
        '',
        'சொத்து: {{3}}',
        'அடுத்த தொடர்பு திட்டமிடப்பட்டுள்ளது: {{4}}',
        '',
        'இந்த தேதியை உறுதிப்படுத்த அல்லது மாற்ற கீழே உள்ள பொத்தானை அழுத்தவும். "இப்போது சொல்ல முடியாது" எனத் தேர்ந்தெடுத்தால், திட்டமிட்ட தொடர்பு நீக்கப்பட்டு விசாரணை திறந்தே இருக்கும்.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, ఇది {{2}} తరఫున ఒక రిమైండర్ — మీ ఆస్తి విచారణ తెరిచి ఉంది, మీ నిర్ణయం కోసం ఎదురుచూస్తోంది.',
        '',
        'ఆస్తి: {{3}}',
        'తదుపరి సంప్రదింపు షెడ్యూల్: {{4}}',
        '',
        'ఈ తేదీని నిర్ధారించడానికి లేదా మార్చడానికి కింది బటన్ నొక్కండి. "ఇప్పుడే చెప్పలేను" ఎంచుకుంటే షెడ్యూల్ తీసివేయబడుతుంది, విచారణ తెరిచే ఉంటుంది.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, ഇത് {{2}} നൽകുന്ന ഓർമ്മപ്പെടുത്തൽ — നിങ്ങളുടെ വസ്തു അന്വേഷണം തുറന്നിരിക്കുന്നു, നിങ്ങളുടെ തീരുമാനത്തിനായി കാത്തിരിക്കുന്നു.',
        '',
        'വസ്തു: {{3}}',
        'അടുത്ത ബന്ധപ്പെടൽ നിശ്ചയിച്ചിരിക്കുന്നത്: {{4}}',
        '',
        'ഈ തീയതി സ്ഥിരീകരിക്കാനോ മാറ്റാനോ താഴെയുള്ള ബട്ടൺ അമർത്തുക. "ഇപ്പോൾ പറയാനാകില്ല" തിരഞ്ഞെടുത്താൽ നിശ്ചയിച്ച ബന്ധപ്പെടൽ നീക്കം ചെയ്യും, അന്വേഷണം തുറന്നിരിക്കും.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, ही {{2}} कडून आठवण — तुमची मालमत्ता चौकशी खुली आहे आणि तुमच्या निर्णयाची वाट पाहत आहे.',
        '',
        'मालमत्ता: {{3}}',
        'पुढील संपर्क नियोजित: {{4}}',
        '',
        'ही तारीख निश्चित करण्यासाठी किंवा बदलण्यासाठी खालील बटण दाबा. "आत्ता सांगू शकत नाही" निवडल्यास नियोजित संपर्क काढून टाकला जाईल आणि चौकशी खुली राहील.'
      ),
    },
  },
  audio_announcement: {
    en: {
      body: lines(
        'Hello {{1}}, there is an update for you from {{2}} — play the video above to hear it.',
        '',
        'Reply here if you would like to know more, or reply STOP to opt out of these updates.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपके लिए एक अपडेट है {{2}} की ओर से — सुनने के लिए ऊपर दिया वीडियो चलाएँ।',
        '',
        'अधिक जानने के लिए यहाँ जवाब दें, या इन अपडेट से हटने के लिए STOP लिखें।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮಗೊಂದು ಅಪ್‌ಡೇಟ್ ಇದೆ {{2}} ಕಡೆಯಿಂದ — ಕೇಳಲು ಮೇಲಿನ ವೀಡಿಯೊ ಪ್ಲೇ ಮಾಡಿ.',
        '',
        'ಹೆಚ್ಚು ತಿಳಿಯಲು ಇಲ್ಲಿ ಉತ್ತರಿಸಿ, ಅಥವಾ ಈ ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು ನಿಲ್ಲಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்களுக்காக ஒரு புதுப்பிப்பு உள்ளது {{2}} இடமிருந்து — கேட்க மேலே உள்ள வீடியோவை இயக்கவும்.',
        '',
        'மேலும் அறிய இங்கே பதிலளிக்கவும், அல்லது இந்தப் புதுப்பிப்புகளை நிறுத்த STOP என பதிலளிக்கவும்.'
      ),
    },
    te: {
      body: lines(
        'నమస్తే {{1}}, మీకు ఒక అప్‌డేట్ ఉంది {{2}} నుంచి — వినడానికి పైన ఉన్న వీడియో ప్లే చేయండి.',
        '',
        'మరింత తెలుసుకోవడానికి ఇక్కడ రిప్లై చేయండి, లేదా ఈ అప్‌డేట్లను ఆపడానికి STOP అని రిప్లై చేయండి.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങൾക്കായി ഒരു അപ്ഡേറ്റ് ഉണ്ട് {{2}} നിന്ന് — കേൾക്കാൻ മുകളിലെ വീഡിയോ പ്ലേ ചെയ്യൂ.',
        '',
        'കൂടുതൽ അറിയാൻ ഇവിടെ മറുപടി നൽകൂ, അല്ലെങ്കിൽ ഈ അപ്ഡേറ്റുകൾ നിർത്താൻ STOP എന്ന് മറുപടി നൽകൂ.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्यासाठी एक अपडेट आहे {{2}} कडून — ऐकण्यासाठी वरील व्हिडिओ प्ले करा.',
        '',
        'अधिक जाणून घेण्यासाठी येथे उत्तर द्या, किंवा हे अपडेट थांबवण्यासाठी STOP असे उत्तर द्या.'
      ),
    },
  },
  post_call_options: {
    en: {
      body: lines(
        'Hi {{1}}, thank you for speaking with {{2}} just now about your property enquiry.',
        '',
        'Requirement noted: {{3}}',
        '',
        'To receive the closest current listings for this requirement, tap "Yes, send them". If not, no further messages will be sent about this call.'
      ),
    },
    hi: {
      body: lines(
        'नमस्ते {{1}}, आपकी प्रॉपर्टी पूछताछ के बारे में अभी {{2}} से बात करने के लिए धन्यवाद।',
        '',
        'दर्ज आवश्यकता: {{3}}',
        '',
        'इस आवश्यकता से मेल खाती मौजूदा लिस्टिंग पाने के लिए "हाँ, भेजें" चुनें। नहीं तो इस कॉल के बारे में कोई और संदेश नहीं भेजा जाएगा।'
      ),
    },
    kn: {
      body: lines(
        'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಆಸ್ತಿ ವಿಚಾರಣೆಯ ಬಗ್ಗೆ ಈಗ {{2}} ಜೊತೆ ಮಾತನಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.',
        '',
        'ದಾಖಲಾದ ಅಗತ್ಯ: {{3}}',
        '',
        'ಈ ಅಗತ್ಯಕ್ಕೆ ಹೊಂದುವ ಈಗಿನ ಆಸ್ತಿಗಳನ್ನು ಪಡೆಯಲು "ಹೌದು, ಕಳುಹಿಸಿ" ಆಯ್ಕೆಮಾಡಿ. ಇಲ್ಲದಿದ್ದರೆ ಈ ಕರೆಯ ಬಗ್ಗೆ ಬೇರೆ ಸಂದೇಶ ಬರುವುದಿಲ್ಲ.'
      ),
    },
    ta: {
      body: lines(
        'வணக்கம் {{1}}, உங்கள் சொத்து விசாரணை குறித்து இப்போது {{2}} உடன் பேசியதற்கு நன்றி.',
        '',
        'பதிவான தேவை: {{3}}',
        '',
        'இந்தத் தேவைக்குப் பொருந்தும் தற்போதைய சொத்துகளைப் பெற "ஆம், அனுப்புங்கள்" தேர்ந்தெடுக்கவும். இல்லையெனில் இந்த அழைப்பு குறித்து வேறு செய்தி அனுப்பப்படாது.'
      ),
    },
    te: {
      body: lines(
        'నమస్కారం {{1}}, మీ ఆస్తి విచారణ గురించి ఇప్పుడు {{2}} తో మాట్లాడినందుకు ధన్యవాదాలు.',
        '',
        'నమోదైన అవసరం: {{3}}',
        '',
        'ఈ అవసరానికి సరిపోయే ప్రస్తుత ఆస్తులను పొందడానికి "అవును, పంపండి" ఎంచుకోండి. లేకపోతే ఈ కాల్ గురించి మరో సందేశం పంపబడదు.'
      ),
    },
    ml: {
      body: lines(
        'നമസ്കാരം {{1}}, നിങ്ങളുടെ വസ്തു അന്വേഷണത്തെക്കുറിച്ച് ഇപ്പോൾ {{2}} യുമായി സംസാരിച്ചതിന് നന്ദി.',
        '',
        'രേഖപ്പെടുത്തിയ ആവശ്യം: {{3}}',
        '',
        'ഈ ആവശ്യത്തിന് ചേരുന്ന നിലവിലെ വസ്തുക്കൾ ലഭിക്കാൻ "അതെ, അയയ്ക്കൂ" തിരഞ്ഞെടുക്കുക. അല്ലെങ്കിൽ ഈ കോളിനെക്കുറിച്ച് വേറെ സന്ദേശം അയയ്ക്കില്ല.'
      ),
    },
    mr: {
      body: lines(
        'नमस्कार {{1}}, तुमच्या मालमत्ता चौकशीबद्दल आत्ताच {{2}} शी बोलल्याबद्दल धन्यवाद.',
        '',
        'नोंदवलेली गरज: {{3}}',
        '',
        'या गरजेशी जुळणाऱ्या सध्याच्या मालमत्ता मिळवण्यासाठी "हो, पाठवा" निवडा. नाहीतर या कॉलबद्दल आणखी संदेश पाठवला जाणार नाही.'
      ),
    },
  },
};

/** Body text for a template in a language, English if untranslated. */
export function templateBody(
  key: EngineTemplateKey,
  language: LanguageCode = DEFAULT_LANGUAGE
): string {
  const copy = TEMPLATE_COPY[key];
  return (copy[language] ?? copy.en!).body;
}

/** Footer text, or undefined when the template has none. */
export function templateFooter(
  key: EngineTemplateKey,
  language: LanguageCode = DEFAULT_LANGUAGE
): string | undefined {
  const copy = TEMPLATE_COPY[key];
  return (copy[language] ?? copy.en!).footer;
}

/** True when we hold real copy for this pair rather than English. */
export function hasTranslation(
  key: EngineTemplateKey,
  language: LanguageCode
): boolean {
  return language === 'en' || TEMPLATE_COPY[key][language] !== undefined;
}

/**
 * A short, stable fingerprint of the copy we ship for one
 * (template, language) pair.
 *
 * Stored on a row when it is created, so later we can tell two things
 * apart that otherwise look identical — a body that differs from the
 * shipped wording because the ACCOUNT edited it, and one that differs
 * because the SHIPPED wording moved on. Without it both read as
 * "different" and the only safe response is to do nothing, which
 * means a copy improvement never reaches anyone.
 *
 * FNV-1a, not a cryptographic digest: this detects change, it does
 * not defend against anyone. It has to be synchronous (crypto.subtle
 * is async and this is called during render) and identical in Node
 * and the browser, which rules out the platform hashes.
 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint of one body+footer pair.
 *
 * Body and footer are hashed separately and concatenated rather than
 * joined by a delimiter: any delimiter is either ambiguous (a body
 * ending in it collides with a footer starting with it) or a control
 * character, and a literal NUL in a source file makes grep treat the
 * whole module as binary. Two fixed-width halves have neither problem.
 *
 * Exported so template-drift.ts fingerprints a stored row through the
 * exact same function. It briefly did not — it kept its own copy of
 * the loop — and the two silently disagreed, which is the whole class
 * of bug this module is meant to detect rather than cause.
 */
export function revisionOf(
  bodyText: string,
  footerText: string | null | undefined
): string {
  return fnv1a(bodyText) + fnv1a(footerText ?? '');
}

export function copyRevision(
  key: EngineTemplateKey,
  language: LanguageCode
): string {
  // Footer included: it is copy a client reads, so a footer-only
  // change is still a change worth offering.
  return revisionOf(templateBody(key, language), templateFooter(key, language));
}

/** Exported for the constraint tests and the review UI. */
export const TEMPLATE_COPY_TABLE = TEMPLATE_COPY;
export const TEMPLATE_BUTTON_LABELS = BUTTON_LABELS;

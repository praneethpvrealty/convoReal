// ============================================================
// UI string catalogue.
//
// English is the source of truth AND the type: MessageKey is derived
// from it, so a key that does not exist in English cannot be
// referenced, and every other language is a Partial. An untranslated
// key silently renders the English string rather than a raw
// `nav.dashboard`, which is what lets this catalogue grow one screen
// at a time instead of needing all seven languages complete before
// any of it ships.
//
// Coverage is deliberately partial today: the app chrome (navigation,
// header, the appearance panel) is translated, and the several
// thousand strings across feature screens are not. Add keys here as
// each screen is converted.
//
// The Indic strings below are a first pass and have NOT been reviewed
// by native speakers. Anything customer-facing should be — see the
// same warning in docs/india-launch-kit.md. These are agent-facing
// UI labels, which is the lowest-risk place to start.
// ============================================================

import type { LanguageCode } from '@/lib/languages';

export const EN = {
  'nav.dashboard': 'Dashboard',
  'nav.inbox': 'Inbox',
  'nav.groups': 'Groups',
  'nav.contacts': 'Contacts',
  'nav.inventory': 'Inventory',
  'nav.liaisons': 'Liaisons',
  'nav.calendar': 'Calendar',
  'nav.journey': 'Journey',
  'nav.automations': 'Automations',
  'nav.broadcasts': 'Broadcasts',
  'nav.ads': 'Ads',
  'nav.settings': 'Settings',
  'nav.adminPanel': 'Admin Panel',

  'nav.quickAccess': 'Quick Access',
  'nav.newDeals': 'New Deals',
  'nav.pendingQuotes': 'Pending Quotes',
  'nav.priorityTasks': 'Priority Tasks',
  'nav.followUps': 'Follow-ups',

  'role.owner': 'Owner',
  'role.admin': 'Admin',
  'role.coordinator': 'Coordinator',
  'role.agent': 'Agent',
  'role.viewer': 'Viewer',

  'common.search': 'Search',
  'search.placeholder': 'Search deals, contacts, or properties...',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.saving': 'Saving…',
  'common.loading': 'Loading…',
  'common.signOut': 'Sign out',

  'appearance.title': 'Appearance',
  'appearance.language': 'Display language',
  'appearance.languageHelp':
    'The language of this app for you. It does not change the language of messages sent to your clients — that is set per contact and per account.',
  'appearance.languageActive': 'Showing',
  'appearance.languageShowNow': 'Show the app in:',
  'appearance.languageCap':
    'You can keep two languages and switch between them from the header.',
  'appearance.languageIncomplete':
    'Translation is in progress: screens that are not translated yet stay in English.',

  'copilot.askSupport': 'Ask the support team',
  'copilot.supportWhere': 'Where should our team reply?',
  'copilot.supportPhone': 'WhatsApp number',
  'copilot.supportEmail': 'Email address',
  'copilot.supportSend': 'Send to support',
  'copilot.supportSending': 'Sending…',
  'copilot.supportSent': 'Sent to the support team — reference',
  'copilot.supportReply': "We'll get back to you on",
  'copilot.featureNoted': 'Noted as a feature request for the ConvoReal team.',

  'inventory.nearMe': 'Near me',
  'inventory.nearYou': 'Showing matches near your location, within',
  'inventory.listView': 'List view',
  'inventory.mapView': 'Map view',
  'inventory.mapNotConfigured': 'Map view is not configured.',
  'inventory.mapFailed':
    'The map failed to load — check the browser key and try again.',
  'inventory.mapNone': 'No mapped listings in this search',
  'inventory.mapped': 'listings mapped',
  'inventory.locationUnavailable': 'Location is not available in this browser.',
  'inventory.locationDenied':
    'Could not get your location — allow location access and try again.',

  'contacts.allProjects': 'All projects',
  'contacts.projectFilter': 'Filter by project',

  'copilot.assistant': 'AI Assistant',
  'copilot.title': 'Helper',
  'copilot.greeting':
    'Hi! I can show you around or answer questions about ConvoReal. 👋',
  'copilot.typing': 'Typing…',
  'copilot.placeholder': 'Ask me anything…',
  'copilot.guides': 'Step-by-step guides',
  'copilot.startTour': 'Show me — start the tour',
  'copilot.openDesktop': 'Open on desktop web',
  'copilot.takeMeThere': 'Take me there',
  'copilot.webOnlyHint': 'This one lives on the desktop web dashboard.',
  'copilot.partialHint': 'I could only partly help with this one.',
  'copilot.helpful': 'Helpful?',
  'copilot.thanks': 'Thanks for the feedback!',
  'copilot.open': 'Open the helper',

  'tour.next': 'Next',
  'tour.done': 'Done',
  'tour.skip': 'Skip',
  'tour.tapHighlight': 'Tap the highlight 👆',
} as const;

export type MessageKey = keyof typeof EN;

type Catalogue = Partial<Record<MessageKey, string>>;

const HI: Catalogue = {
  'nav.dashboard': 'डैशबोर्ड',
  'nav.inbox': 'इनबॉक्स',
  'nav.groups': 'समूह',
  'nav.contacts': 'संपर्क',
  'nav.inventory': 'इन्वेंटरी',
  'nav.liaisons': 'सेवा प्रदाता',
  'nav.calendar': 'कैलेंडर',
  'nav.journey': 'जर्नी',
  'nav.automations': 'ऑटोमेशन',
  'nav.broadcasts': 'ब्रॉडकास्ट',
  'nav.ads': 'विज्ञापन',
  'nav.settings': 'सेटिंग्स',
  'nav.adminPanel': 'एडमिन पैनल',

  'nav.quickAccess': 'त्वरित पहुँच',
  'nav.newDeals': 'नए सौदे',
  'nav.pendingQuotes': 'लंबित कोटेशन',
  'nav.priorityTasks': 'प्राथमिक कार्य',
  'nav.followUps': 'फ़ॉलो-अप',

  'role.owner': 'मालिक',
  'role.admin': 'एडमिन',
  'role.coordinator': 'समन्वयक',
  'role.agent': 'एजेंट',
  'role.viewer': 'दर्शक',

  'common.search': 'खोजें',
  'search.placeholder': 'सौदे, संपर्क या संपत्तियाँ खोजें...',
  'common.save': 'सहेजें',
  'common.cancel': 'रद्द करें',
  'common.saving': 'सहेजा जा रहा है…',
  'common.loading': 'लोड हो रहा है…',
  'common.signOut': 'साइन आउट',

  'appearance.title': 'दिखावट',
  'appearance.language': 'प्रदर्शन भाषा',
  'appearance.languageHelp':
    'आपके लिए इस ऐप की भाषा। इससे आपके ग्राहकों को भेजे जाने वाले संदेशों की भाषा नहीं बदलती — वह हर संपर्क और खाते के लिए अलग से तय होती है।',
  'appearance.languageActive': 'दिख रहा है',
  'appearance.languageShowNow': 'ऐप इस भाषा में दिखाएँ:',
  'appearance.languageCap':
    'आप दो भाषाएँ रख सकते हैं और हेडर से उनके बीच बदल सकते हैं।',
  'appearance.languageIncomplete':
    'अनुवाद जारी है: जो स्क्रीन अभी अनुवादित नहीं हैं वे अंग्रेज़ी में ही रहेंगी।',
  'copilot.askSupport': 'सपोर्ट टीम से पूछें',
  'copilot.supportWhere': 'हमारी टीम कहाँ जवाब दे?',
  'copilot.supportPhone': 'WhatsApp नंबर',
  'copilot.supportEmail': 'ईमेल पता',
  'copilot.supportSend': 'सपोर्ट को भेजें',
  'copilot.supportSending': 'भेजा जा रहा है…',
  'copilot.supportSent': 'सपोर्ट टीम को भेज दिया — संदर्भ',
  'copilot.supportReply': 'हम आपको जवाब देंगे —',
  'copilot.featureNoted':
    'ConvoReal टीम के लिए फ़ीचर अनुरोध के रूप में दर्ज किया गया।',
  'inventory.nearMe': 'मेरे पास',
  'inventory.nearYou': 'आपके स्थान के पास के मिलान, इस दायरे में',
  'inventory.listView': 'सूची दृश्य',
  'inventory.mapView': 'नक्शा दृश्य',
  'inventory.mapNotConfigured': 'नक्शा दृश्य सेट नहीं है।',
  'inventory.mapFailed':
    'नक्शा लोड नहीं हुआ — ब्राउज़र key जाँचें और फिर कोशिश करें।',
  'inventory.mapNone': 'इस खोज में नक्शे पर कोई लिस्टिंग नहीं',
  'inventory.mapped': 'लिस्टिंग नक्शे पर',
  'inventory.locationUnavailable': 'इस ब्राउज़र में लोकेशन उपलब्ध नहीं है।',
  'inventory.locationDenied':
    'आपकी लोकेशन नहीं मिली — लोकेशन की अनुमति देकर फिर कोशिश करें।',
  'contacts.allProjects': 'सभी प्रोजेक्ट',
  'contacts.projectFilter': 'प्रोजेक्ट से फ़िल्टर करें',
  'copilot.assistant': 'एआई सहायक',
  'copilot.title': 'हेल्पर',
  'copilot.greeting':
    'नमस्ते! मैं आपको ऐप घुमा सकता हूँ या ConvoReal के बारे में सवालों के जवाब दे सकता हूँ। 👋',
  'copilot.typing': 'लिख रहा है…',
  'copilot.placeholder': 'कुछ भी पूछें…',
  'copilot.guides': 'कदम-दर-कदम गाइड',
  'copilot.startTour': 'मुझे दिखाओ — टूर शुरू करें',
  'copilot.openDesktop': 'डेस्कटॉप वेब पर खोलें',
  'copilot.takeMeThere': 'मुझे वहाँ ले चलो',
  'copilot.webOnlyHint': 'यह डेस्कटॉप वेब डैशबोर्ड पर ही उपलब्ध है।',
  'copilot.partialHint': 'इसमें मैं सिर्फ़ आंशिक मदद कर सका।',
  'copilot.helpful': 'मददगार?',
  'copilot.thanks': 'फ़ीडबैक के लिए धन्यवाद!',
  'copilot.open': 'हेल्पर खोलें',
  'tour.next': 'आगे',
  'tour.done': 'हो गया',
  'tour.skip': 'छोड़ें',
  'tour.tapHighlight': 'हाइलाइट पर टैप करें 👆',
};

const KN: Catalogue = {
  'nav.dashboard': 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
  'nav.inbox': 'ಇನ್‌ಬಾಕ್ಸ್',
  'nav.groups': 'ಗುಂಪುಗಳು',
  'nav.contacts': 'ಸಂಪರ್ಕಗಳು',
  'nav.inventory': 'ಆಸ್ತಿ ಪಟ್ಟಿ',
  'nav.liaisons': 'ಸೇವಾ ಪೂರೈಕೆದಾರರು',
  'nav.calendar': 'ಕ್ಯಾಲೆಂಡರ್',
  'nav.journey': 'ಪ್ರಯಾಣ',
  'nav.automations': 'ಸ್ವಯಂಚಾಲನೆ',
  'nav.broadcasts': 'ಪ್ರಸಾರಗಳು',
  'nav.ads': 'ಜಾಹೀರಾತುಗಳು',
  'nav.settings': 'ಸಂಯೋಜನೆಗಳು',
  'nav.adminPanel': 'ಆಡ್ಮಿನ್ ಪ್ಯಾನಲ್',

  'nav.quickAccess': 'ತ್ವರಿತ ಪ್ರವೇಶ',
  'nav.newDeals': 'ಹೊಸ ಒಪ್ಪಂದಗಳು',
  'nav.pendingQuotes': 'ಬಾಕಿ ಉಳಿದ ದರಪಟ್ಟಿಗಳು',
  'nav.priorityTasks': 'ಆದ್ಯತೆಯ ಕಾರ್ಯಗಳು',
  'nav.followUps': 'ಅನುಸರಣೆಗಳು',

  'role.owner': 'ಮಾಲೀಕ',
  'role.admin': 'ಆಡ್ಮಿನ್',
  'role.coordinator': 'ಸಂಯೋಜಕ',
  'role.agent': 'ಏಜೆಂಟ್',
  'role.viewer': 'ವೀಕ್ಷಕ',

  'common.search': 'ಹುಡುಕಿ',
  'search.placeholder': 'ಒಪ್ಪಂದಗಳು, ಸಂಪರ್ಕಗಳು ಅಥವಾ ಆಸ್ತಿಗಳನ್ನು ಹುಡುಕಿ...',
  'common.save': 'ಉಳಿಸಿ',
  'common.cancel': 'ರದ್ದುಮಾಡಿ',
  'common.saving': 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…',
  'common.loading': 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  'common.signOut': 'ಸೈನ್ ಔಟ್',

  'appearance.title': 'ಗೋಚರಿಕೆ',
  'appearance.language': 'ಪ್ರದರ್ಶನ ಭಾಷೆ',
  'appearance.languageHelp':
    'ನಿಮಗಾಗಿ ಈ ಆ್ಯಪ್‌ನ ಭಾಷೆ. ಇದು ನಿಮ್ಮ ಗ್ರಾಹಕರಿಗೆ ಕಳುಹಿಸುವ ಸಂದೇಶಗಳ ಭಾಷೆಯನ್ನು ಬದಲಾಯಿಸುವುದಿಲ್ಲ — ಅದನ್ನು ಪ್ರತಿ ಸಂಪರ್ಕ ಮತ್ತು ಖಾತೆಗೆ ಪ್ರತ್ಯೇಕವಾಗಿ ಹೊಂದಿಸಲಾಗುತ್ತದೆ.',
  'appearance.languageActive': 'ತೋರಿಸುತ್ತಿದೆ',
  'appearance.languageShowNow': 'ಆ್ಯಪ್ ಅನ್ನು ಈ ಭಾಷೆಯಲ್ಲಿ ತೋರಿಸಿ:',
  'appearance.languageCap':
    'ನೀವು ಎರಡು ಭಾಷೆಗಳನ್ನು ಇಟ್ಟುಕೊಂಡು ಹೆಡರ್‌ನಿಂದ ಬದಲಾಯಿಸಬಹುದು.',
  'appearance.languageIncomplete':
    'ಅನುವಾದ ಪ್ರಗತಿಯಲ್ಲಿದೆ: ಇನ್ನೂ ಅನುವಾದಿಸದ ಪರದೆಗಳು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿಯೇ ಇರುತ್ತವೆ.',
  'copilot.askSupport': 'ಸಪೋರ್ಟ್ ತಂಡವನ್ನು ಕೇಳಿ',
  'copilot.supportWhere': 'ನಮ್ಮ ತಂಡ ಎಲ್ಲಿ ಉತ್ತರಿಸಬೇಕು?',
  'copilot.supportPhone': 'WhatsApp ಸಂಖ್ಯೆ',
  'copilot.supportEmail': 'ಇಮೇಲ್ ವಿಳಾಸ',
  'copilot.supportSend': 'ಸಪೋರ್ಟ್\u200cಗೆ ಕಳುಹಿಸಿ',
  'copilot.supportSending': 'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…',
  'copilot.supportSent': 'ಸಪೋರ್ಟ್ ತಂಡಕ್ಕೆ ಕಳುಹಿಸಲಾಗಿದೆ — ಉಲ್ಲೇಖ',
  'copilot.supportReply': 'ನಾವು ನಿಮಗೆ ಉತ್ತರಿಸುತ್ತೇವೆ —',
  'copilot.featureNoted': 'ConvoReal ತಂಡಕ್ಕೆ ಫೀಚರ್ ವಿನಂತಿಯಾಗಿ ದಾಖಲಿಸಲಾಗಿದೆ.',
  'inventory.nearMe': 'ನನ್ನ ಹತ್ತಿರ',
  'inventory.nearYou': 'ನಿಮ್ಮ ಸ್ಥಳದ ಹತ್ತಿರದ ಹೊಂದಾಣಿಕೆಗಳು, ಈ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ',
  'inventory.listView': 'ಪಟ್ಟಿ ನೋಟ',
  'inventory.mapView': 'ನಕ್ಷೆ ನೋಟ',
  'inventory.mapNotConfigured': 'ನಕ್ಷೆ ನೋಟ ಸಂರಚಿಸಿಲ್ಲ.',
  'inventory.mapFailed':
    'ನಕ್ಷೆ ಲೋಡ್ ಆಗಲಿಲ್ಲ — ಬ್ರೌಸರ್ key ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  'inventory.mapNone': 'ಈ ಹುಡುಕಾಟದಲ್ಲಿ ನಕ್ಷೆಯ ಲಿಸ್ಟಿಂಗ್ ಇಲ್ಲ',
  'inventory.mapped': 'ಲಿಸ್ಟಿಂಗ್\u200cಗಳು ನಕ್ಷೆಯಲ್ಲಿ',
  'inventory.locationUnavailable': 'ಈ ಬ್ರೌಸರ್\u200cನಲ್ಲಿ ಸ್ಥಳ ಲಭ್ಯವಿಲ್ಲ.',
  'inventory.locationDenied':
    'ನಿಮ್ಮ ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ — ಸ್ಥಳದ ಅನುಮತಿ ನೀಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  'contacts.allProjects': 'ಎಲ್ಲ ಪ್ರಾಜೆಕ್ಟ್\u200cಗಳು',
  'contacts.projectFilter': 'ಪ್ರಾಜೆಕ್ಟ್ ಮೂಲಕ ಫಿಲ್ಟರ್',
  'copilot.assistant': 'ಎಐ ಸಹಾಯಕ',
  'copilot.title': 'ಹೆಲ್ಪರ್',
  'copilot.greeting':
    'ನಮಸ್ಕಾರ! ನಾನು ಆ್ಯಪ್ ತೋರಿಸಬಲ್ಲೆ ಅಥವಾ ConvoReal ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸಬಲ್ಲೆ. 👋',
  'copilot.typing': 'ಬರೆಯುತ್ತಿದೆ…',
  'copilot.placeholder': 'ಏನಾದರೂ ಕೇಳಿ…',
  'copilot.guides': 'ಹಂತ-ಹಂತದ ಗೈಡ್\u200cಗಳು',
  'copilot.startTour': 'ನನಗೆ ತೋರಿಸಿ — ಟೂರ್ ಆರಂಭಿಸಿ',
  'copilot.openDesktop': 'ಡೆಸ್ಕ್\u200cಟಾಪ್ ವೆಬ್\u200cನಲ್ಲಿ ತೆರೆಯಿರಿ',
  'copilot.takeMeThere': 'ನನ್ನನ್ನು ಅಲ್ಲಿಗೆ ಕರೆದೊಯ್ಯಿರಿ',
  'copilot.webOnlyHint':
    'ಇದು ಡೆಸ್ಕ್\u200cಟಾಪ್ ವೆಬ್ ಡ್ಯಾಶ್\u200cಬೋರ್ಡ್\u200cನಲ್ಲಿ ಮಾತ್ರ ಇದೆ.',
  'copilot.partialHint': 'ಇದರಲ್ಲಿ ನಾನು ಭಾಗಶಃ ಮಾತ್ರ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ.',
  'copilot.helpful': 'ಸಹಾಯಕವೇ?',
  'copilot.thanks': 'ಪ್ರತಿಕ್ರಿಯೆಗೆ ಧನ್ಯವಾದಗಳು!',
  'copilot.open': 'ಹೆಲ್ಪರ್ ತೆರೆಯಿರಿ',
  'tour.next': 'ಮುಂದೆ',
  'tour.done': 'ಮುಗಿಯಿತು',
  'tour.skip': 'ಬಿಟ್ಟುಬಿಡಿ',
  'tour.tapHighlight': 'ಹೈಲೈಟ್ ಟ್ಯಾಪ್ ಮಾಡಿ 👆',
};

const TA: Catalogue = {
  'nav.dashboard': 'டாஷ்போர்டு',
  'nav.inbox': 'இன்பாக்ஸ்',
  'nav.groups': 'குழுக்கள்',
  'nav.contacts': 'தொடர்புகள்',
  'nav.inventory': 'சொத்துப் பட்டியல்',
  'nav.liaisons': 'சேவை வழங்குநர்கள்',
  'nav.calendar': 'நாட்காட்டி',
  'nav.journey': 'பயணம்',
  'nav.automations': 'தானியக்கம்',
  'nav.broadcasts': 'ஒளிபரப்புகள்',
  'nav.ads': 'விளம்பரங்கள்',
  'nav.settings': 'அமைப்புகள்',
  'nav.adminPanel': 'நிர்வாகப் பலகை',

  'nav.quickAccess': 'விரைவு அணுகல்',
  'nav.newDeals': 'புதிய ஒப்பந்தங்கள்',
  'nav.pendingQuotes': 'நிலுவையில் உள்ள மதிப்பீடுகள்',
  'nav.priorityTasks': 'முன்னுரிமைப் பணிகள்',
  'nav.followUps': 'தொடர் நடவடிக்கைகள்',

  'role.owner': 'உரிமையாளர்',
  'role.admin': 'நிர்வாகி',
  'role.coordinator': 'ஒருங்கிணைப்பாளர்',
  'role.agent': 'முகவர்',
  'role.viewer': 'பார்வையாளர்',

  'common.search': 'தேடு',
  'search.placeholder':
    'ஒப்பந்தங்கள், தொடர்புகள் அல்லது சொத்துகளைத் தேடுங்கள்...',
  'common.save': 'சேமி',
  'common.cancel': 'ரத்துசெய்',
  'common.saving': 'சேமிக்கிறது…',
  'common.loading': 'ஏற்றுகிறது…',
  'common.signOut': 'வெளியேறு',

  'appearance.title': 'தோற்றம்',
  'appearance.language': 'காட்சி மொழி',
  'appearance.languageHelp':
    'உங்களுக்கான இந்த ஆப்பின் மொழி. இது உங்கள் வாடிக்கையாளர்களுக்கு அனுப்பப்படும் செய்திகளின் மொழியை மாற்றாது — அது ஒவ்வொரு தொடர்புக்கும் கணக்குக்கும் தனித்தனியாக அமைக்கப்படுகிறது.',
  'appearance.languageActive': 'காட்டப்படுகிறது',
  'appearance.languageShowNow': 'ஆப்பை இந்த மொழியில் காட்டு:',
  'appearance.languageCap':
    'நீங்கள் இரண்டு மொழிகளை வைத்துக்கொண்டு தலைப்புப் பகுதியில் இருந்து மாற்றலாம்.',
  'appearance.languageIncomplete':
    'மொழிபெயர்ப்பு நடைபெறுகிறது: இன்னும் மொழிபெயர்க்கப்படாத திரைகள் ஆங்கிலத்திலேயே இருக்கும்.',
  'copilot.askSupport': 'சப்போர்ட் குழுவிடம் கேளுங்கள்',
  'copilot.supportWhere': 'எங்கள் குழு எங்கு பதிலளிக்க வேண்டும்?',
  'copilot.supportPhone': 'WhatsApp எண்',
  'copilot.supportEmail': 'மின்னஞ்சல் முகவரி',
  'copilot.supportSend': 'சப்போர்ட்டுக்கு அனுப்பு',
  'copilot.supportSending': 'அனுப்பப்படுகிறது…',
  'copilot.supportSent': 'சப்போர்ட் குழுவிற்கு அனுப்பப்பட்டது — குறிப்பு',
  'copilot.supportReply': 'நாங்கள் உங்களுக்கு பதிலளிப்போம் —',
  'copilot.featureNoted':
    'ConvoReal குழுவிற்கான அம்ச கோரிக்கையாக பதிவு செய்யப்பட்டது.',
  'inventory.nearMe': 'என் அருகில்',
  'inventory.nearYou':
    'உங்கள் இடத்திற்கு அருகிலுள்ள பொருத்தங்கள், இந்த எல்லைக்குள்',
  'inventory.listView': 'பட்டியல் காட்சி',
  'inventory.mapView': 'வரைபடக் காட்சி',
  'inventory.mapNotConfigured': 'வரைபடக் காட்சி அமைக்கப்படவில்லை.',
  'inventory.mapFailed':
    'வரைபடம் ஏற்றப்படவில்லை — browser key சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
  'inventory.mapNone': 'இந்தத் தேடலில் வரைபடத்தில் லிஸ்டிங் இல்லை',
  'inventory.mapped': 'லிஸ்டிங்குகள் வரைபடத்தில்',
  'inventory.locationUnavailable': 'இந்த browser-இல் இருப்பிடம் கிடைக்கவில்லை.',
  'inventory.locationDenied':
    'உங்கள் இருப்பிடம் கிடைக்கவில்லை — இருப்பிட அனுமதி வழங்கி மீண்டும் முயற்சிக்கவும்.',
  'contacts.allProjects': 'எல்லா ப்ராஜெக்ட்களும்',
  'contacts.projectFilter': 'ப்ராஜெக்ட் வாரியாக வடிகட்டு',
  'copilot.assistant': 'AI உதவியாளர்',
  'copilot.title': 'ஹெல்பர்',
  'copilot.greeting':
    'வணக்கம்! நான் ஆப்பை சுற்றிக் காட்டவோ, ConvoReal பற்றிய கேள்விகளுக்கு பதிலளிக்கவோ முடியும். 👋',
  'copilot.typing': 'எழுதுகிறது…',
  'copilot.placeholder': 'எதுவும் கேளுங்கள்…',
  'copilot.guides': 'படிப்படியான வழிகாட்டிகள்',
  'copilot.startTour': 'எனக்கு காட்டு — டூரை தொடங்கு',
  'copilot.openDesktop': 'டெஸ்க்டாப் வெப்பில் திற',
  'copilot.takeMeThere': 'என்னை அங்கே அழைத்துச் செல்',
  'copilot.webOnlyHint': 'இது டெஸ்க்டாப் வெப் டாஷ்போர்டில் மட்டுமே உள்ளது.',
  'copilot.partialHint': 'இதில் நான் பகுதியளவே உதவ முடிந்தது.',
  'copilot.helpful': 'உதவியாக இருந்ததா?',
  'copilot.thanks': 'கருத்துக்கு நன்றி!',
  'copilot.open': 'ஹெல்பரை திற',
  'tour.next': 'அடுத்து',
  'tour.done': 'முடிந்தது',
  'tour.skip': 'தவிர்',
  'tour.tapHighlight': 'ஹைலைட்டை தட்டவும் 👆',
};

const TE: Catalogue = {
  'nav.dashboard': 'డాష్‌బోర్డ్',
  'nav.inbox': 'ఇన్‌బాక్స్',
  'nav.groups': 'సమూహాలు',
  'nav.contacts': 'పరిచయాలు',
  'nav.inventory': 'ఆస్తుల జాబితా',
  'nav.liaisons': 'సేవా ప్రదాతలు',
  'nav.calendar': 'క్యాలెండర్',
  'nav.journey': 'ప్రయాణం',
  'nav.automations': 'ఆటోమేషన్లు',
  'nav.broadcasts': 'ప్రసారాలు',
  'nav.ads': 'ప్రకటనలు',
  'nav.settings': 'సెట్టింగ్‌లు',
  'nav.adminPanel': 'అడ్మిన్ ప్యానెల్',

  'nav.quickAccess': 'త్వరిత ప్రవేశం',
  'nav.newDeals': 'కొత్త ఒప్పందాలు',
  'nav.pendingQuotes': 'పెండింగ్ కోట్‌లు',
  'nav.priorityTasks': 'ప్రాధాన్య పనులు',
  'nav.followUps': 'ఫాలో-అప్‌లు',

  'role.owner': 'యజమాని',
  'role.admin': 'అడ్మిన్',
  'role.coordinator': 'సమన్వయకర్త',
  'role.agent': 'ఏజెంట్',
  'role.viewer': 'వీక్షకుడు',

  'common.search': 'వెతకండి',
  'search.placeholder': 'ఒప్పందాలు, పరిచయాలు లేదా ఆస్తులను వెతకండి...',
  'common.save': 'సేవ్ చేయండి',
  'common.cancel': 'రద్దు చేయండి',
  'common.saving': 'సేవ్ అవుతోంది…',
  'common.loading': 'లోడ్ అవుతోంది…',
  'common.signOut': 'సైన్ అవుట్',

  'appearance.title': 'రూపం',
  'appearance.language': 'ప్రదర్శన భాష',
  'appearance.languageHelp':
    'మీ కోసం ఈ యాప్ భాష. ఇది మీ క్లయింట్లకు పంపే సందేశాల భాషను మార్చదు — అది ప్రతి పరిచయానికి, ఖాతాకు విడిగా సెట్ చేయబడుతుంది.',
  'appearance.languageActive': 'చూపిస్తోంది',
  'appearance.languageShowNow': 'యాప్‌ను ఈ భాషలో చూపించు:',
  'appearance.languageCap':
    'మీరు రెండు భాషలను ఉంచుకుని హెడర్ నుండి మార్చుకోవచ్చు.',
  'appearance.languageIncomplete':
    'అనువాదం జరుగుతోంది: ఇంకా అనువదించని స్క్రీన్‌లు ఆంగ్లంలోనే ఉంటాయి.',
  'copilot.askSupport': 'సపోర్ట్ టీమ్\u200cను అడగండి',
  'copilot.supportWhere': 'మా టీమ్ ఎక్కడ సమాధానం ఇవ్వాలి?',
  'copilot.supportPhone': 'WhatsApp నంబర్',
  'copilot.supportEmail': 'ఇమెయిల్ చిరునామా',
  'copilot.supportSend': 'సపోర్ట్\u200cకు పంపండి',
  'copilot.supportSending': 'పంపుతున్నాం…',
  'copilot.supportSent': 'సపోర్ట్ టీమ్\u200cకు పంపాం — సూచన',
  'copilot.supportReply': 'మేము మీకు సమాధానం ఇస్తాం —',
  'copilot.featureNoted': 'ConvoReal టీమ్ కోసం ఫీచర్ అభ్యర్థనగా నమోదైంది.',
  'inventory.nearMe': 'నా దగ్గర',
  'inventory.nearYou': 'మీ ప్రదేశానికి దగ్గరి సరిపోలికలు, ఈ పరిధిలో',
  'inventory.listView': 'జాబితా వీక్షణ',
  'inventory.mapView': 'మ్యాప్ వీక్షణ',
  'inventory.mapNotConfigured': 'మ్యాప్ వీక్షణ సెటప్ కాలేదు.',
  'inventory.mapFailed':
    'మ్యాప్ లోడ్ కాలేదు — browser key చూసి మళ్లీ ప్రయత్నించండి.',
  'inventory.mapNone': 'ఈ శోధనలో మ్యాప్\u200cలో లిస్టింగ్ లేదు',
  'inventory.mapped': 'లిస్టింగ్\u200cలు మ్యాప్\u200cలో',
  'inventory.locationUnavailable': 'ఈ browser-లో లొకేషన్ అందుబాటులో లేదు.',
  'inventory.locationDenied':
    'మీ లొకేషన్ దొరకలేదు — లొకేషన్ అనుమతి ఇచ్చి మళ్లీ ప్రయత్నించండి.',
  'contacts.allProjects': 'అన్ని ప్రాజెక్టులు',
  'contacts.projectFilter': 'ప్రాజెక్ట్ ద్వారా ఫిల్టర్',
  'copilot.assistant': 'ఏఐ సహాయకుడు',
  'copilot.title': 'హెల్పర్',
  'copilot.greeting':
    'నమస్తే! నేను యాప్ చూపించగలను లేదా ConvoReal గురించి ప్రశ్నలకు సమాధానం ఇవ్వగలను. 👋',
  'copilot.typing': 'టైప్ చేస్తోంది…',
  'copilot.placeholder': 'ఏదైనా అడగండి…',
  'copilot.guides': 'దశల వారీ గైడ్\u200cలు',
  'copilot.startTour': 'నాకు చూపించు — టూర్ ప్రారంభించు',
  'copilot.openDesktop': 'డెస్క్\u200cటాప్ వెబ్\u200cలో తెరవండి',
  'copilot.takeMeThere': 'నన్ను అక్కడికి తీసుకెళ్లు',
  'copilot.webOnlyHint':
    'ఇది డెస్క్\u200cటాప్ వెబ్ డాష్\u200cబోర్డ్\u200cలో మాత్రమే ఉంది.',
  'copilot.partialHint': 'ఇందులో నేను పాక్షికంగా మాత్రమే సహాయం చేయగలిగాను.',
  'copilot.helpful': 'సహాయపడిందా?',
  'copilot.thanks': 'ఫీడ్\u200cబ్యాక్\u200cకు ధన్యవాదాలు!',
  'copilot.open': 'హెల్పర్ తెరవండి',
  'tour.next': 'తర్వాత',
  'tour.done': 'అయిపోయింది',
  'tour.skip': 'దాటవేయి',
  'tour.tapHighlight': 'హైలైట్\u200cను నొక్కండి 👆',
};

const ML: Catalogue = {
  'nav.dashboard': 'ഡാഷ്‌ബോർഡ്',
  'nav.inbox': 'ഇൻബോക്സ്',
  'nav.groups': 'ഗ്രൂപ്പുകൾ',
  'nav.contacts': 'ബന്ധങ്ങൾ',
  'nav.inventory': 'സ്വത്ത് പട്ടിക',
  'nav.liaisons': 'സേവന ദാതാക്കൾ',
  'nav.calendar': 'കലണ്ടർ',
  'nav.journey': 'യാത്ര',
  'nav.automations': 'ഓട്ടോമേഷനുകൾ',
  'nav.broadcasts': 'പ്രക്ഷേപണങ്ങൾ',
  'nav.ads': 'പരസ്യങ്ങൾ',
  'nav.settings': 'ക്രമീകരണങ്ങൾ',
  'nav.adminPanel': 'അഡ്മിൻ പാനൽ',

  'nav.quickAccess': 'വേഗ പ്രവേശനം',
  'nav.newDeals': 'പുതിയ ഇടപാടുകൾ',
  'nav.pendingQuotes': 'തീർപ്പാക്കാത്ത ക്വോട്ടുകൾ',
  'nav.priorityTasks': 'മുൻഗണനാ ജോലികൾ',
  'nav.followUps': 'ഫോളോ-അപ്പുകൾ',

  'role.owner': 'ഉടമ',
  'role.admin': 'അഡ്മിൻ',
  'role.coordinator': 'ഏകോപകൻ',
  'role.agent': 'ഏജന്റ്',
  'role.viewer': 'കാഴ്ചക്കാരൻ',

  'common.search': 'തിരയുക',
  'search.placeholder': 'ഇടപാടുകൾ, ബന്ധങ്ങൾ അല്ലെങ്കിൽ സ്വത്തുകൾ തിരയുക...',
  'common.save': 'സേവ് ചെയ്യുക',
  'common.cancel': 'റദ്ദാക്കുക',
  'common.saving': 'സേവ് ചെയ്യുന്നു…',
  'common.loading': 'ലോഡ് ചെയ്യുന്നു…',
  'common.signOut': 'സൈൻ ഔട്ട്',

  'appearance.title': 'രൂപം',
  'appearance.language': 'പ്രദർശന ഭാഷ',
  'appearance.languageHelp':
    'നിങ്ങൾക്കായി ഈ ആപ്പിന്റെ ഭാഷ. ഇത് നിങ്ങളുടെ ക്ലയന്റുകൾക്ക് അയക്കുന്ന സന്ദേശങ്ങളുടെ ഭാഷ മാറ്റില്ല — അത് ഓരോ ബന്ധത്തിനും അക്കൗണ്ടിനും വെവ്വേറെ ക്രമീകരിക്കുന്നു.',
  'appearance.languageActive': 'കാണിക്കുന്നു',
  'appearance.languageShowNow': 'ആപ്പ് ഈ ഭാഷയിൽ കാണിക്കുക:',
  'appearance.languageCap':
    'നിങ്ങൾക്ക് രണ്ട് ഭാഷകൾ സൂക്ഷിച്ച് ഹെഡറിൽ നിന്ന് മാറാം.',
  'appearance.languageIncomplete':
    'വിവർത്തനം പുരോഗമിക്കുന്നു: ഇതുവരെ വിവർത്തനം ചെയ്യാത്ത സ്ക്രീനുകൾ ഇംഗ്ലീഷിൽ തന്നെ തുടരും.',
  'copilot.askSupport': 'സപ്പോർട്ട് ടീമിനോട് ചോദിക്കുക',
  'copilot.supportWhere': 'ഞങ്ങളുടെ ടീം എവിടെ മറുപടി നൽകണം?',
  'copilot.supportPhone': 'WhatsApp നമ്പർ',
  'copilot.supportEmail': 'ഇമെയിൽ വിലാസം',
  'copilot.supportSend': 'സപ്പോർട്ടിലേക്ക് അയയ്ക്കുക',
  'copilot.supportSending': 'അയയ്ക്കുന്നു…',
  'copilot.supportSent': 'സപ്പോർട്ട് ടീമിന് അയച്ചു — റഫറൻസ്',
  'copilot.supportReply': 'ഞങ്ങൾ നിങ്ങൾക്ക് മറുപടി നൽകും —',
  'copilot.featureNoted':
    'ConvoReal ടീമിനുള്ള ഫീച്ചർ അഭ്യർത്ഥനയായി രേഖപ്പെടുത്തി.',
  'inventory.nearMe': 'എന്റെ അടുത്ത്',
  'inventory.nearYou':
    'നിങ്ങളുടെ സ്ഥലത്തിന് അടുത്തുള്ള പൊരുത്തങ്ങൾ, ഈ പരിധിയിൽ',
  'inventory.listView': 'ലിസ്റ്റ് കാഴ്ച',
  'inventory.mapView': 'മാപ്പ് കാഴ്ച',
  'inventory.mapNotConfigured': 'മാപ്പ് കാഴ്ച സജ്ജീകരിച്ചിട്ടില്ല.',
  'inventory.mapFailed':
    'മാപ്പ് ലോഡായില്ല — browser key പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കുക.',
  'inventory.mapNone': 'ഈ തിരയലിൽ മാപ്പിൽ ലിസ്റ്റിംഗ് ഇല്ല',
  'inventory.mapped': 'ലിസ്റ്റിംഗുകൾ മാപ്പിൽ',
  'inventory.locationUnavailable': 'ഈ browser-ൽ ലൊക്കേഷൻ ലഭ്യമല്ല.',
  'inventory.locationDenied':
    'നിങ്ങളുടെ ലൊക്കേഷൻ കിട്ടിയില്ല — ലൊക്കേഷൻ അനുമതി നൽകി വീണ്ടും ശ്രമിക്കുക.',
  'contacts.allProjects': 'എല്ലാ പ്രോജക്ടുകളും',
  'contacts.projectFilter': 'പ്രോജക്ട് പ്രകാരം ഫിൽട്ടർ',
  'copilot.assistant': 'എഐ സഹായി',
  'copilot.title': 'ഹെൽപ്പർ',
  'copilot.greeting':
    'നമസ്കാരം! എനിക്ക് ആപ്പ് ചുറ്റിക്കാണിക്കാം, ConvoReal-നെക്കുറിച്ചുള്ള ചോദ്യങ്ങൾക്ക് ഉത്തരം നൽകാം. 👋',
  'copilot.typing': 'ടൈപ്പ് ചെയ്യുന്നു…',
  'copilot.placeholder': 'എന്തും ചോദിക്കൂ…',
  'copilot.guides': 'ഘട്ടം ഘട്ടമായുള്ള ഗൈഡുകൾ',
  'copilot.startTour': 'എനിക്ക് കാണിച്ചുതരൂ — ടൂർ തുടങ്ങൂ',
  'copilot.openDesktop': 'ഡെസ്ക്ടോപ്പ് വെബിൽ തുറക്കുക',
  'copilot.takeMeThere': 'എന്നെ അവിടേക്ക് കൊണ്ടുപോകൂ',
  'copilot.webOnlyHint': 'ഇത് ഡെസ്ക്ടോപ്പ് വെബ് ഡാഷ്ബോർഡിൽ മാത്രമാണ്.',
  'copilot.partialHint': 'ഇതിൽ എനിക്ക് ഭാഗികമായി മാത്രമേ സഹായിക്കാനായുള്ളൂ.',
  'copilot.helpful': 'സഹായകമായോ?',
  'copilot.thanks': 'ഫീഡ്ബാക്കിന് നന്ദി!',
  'copilot.open': 'ഹെൽപ്പർ തുറക്കുക',
  'tour.next': 'അടുത്തത്',
  'tour.done': 'കഴിഞ്ഞു',
  'tour.skip': 'ഒഴിവാക്കുക',
  'tour.tapHighlight': 'ഹൈലൈറ്റിൽ ടാപ്പ് ചെയ്യുക 👆',
};

const MR: Catalogue = {
  'nav.dashboard': 'डॅशबोर्ड',
  'nav.inbox': 'इनबॉक्स',
  'nav.groups': 'गट',
  'nav.contacts': 'संपर्क',
  'nav.inventory': 'मालमत्ता यादी',
  'nav.liaisons': 'सेवा पुरवठादार',
  'nav.calendar': 'दिनदर्शिका',
  'nav.journey': 'प्रवास',
  'nav.automations': 'ऑटोमेशन',
  'nav.broadcasts': 'प्रसारणे',
  'nav.ads': 'जाहिराती',
  'nav.settings': 'सेटिंग्ज',
  'nav.adminPanel': 'अ‍ॅडमिन पॅनेल',

  'nav.quickAccess': 'जलद प्रवेश',
  'nav.newDeals': 'नवीन व्यवहार',
  'nav.pendingQuotes': 'प्रलंबित कोटेशन',
  'nav.priorityTasks': 'प्राधान्य कामे',
  'nav.followUps': 'फॉलो-अप',

  'role.owner': 'मालक',
  'role.admin': 'अ‍ॅडमिन',
  'role.coordinator': 'समन्वयक',
  'role.agent': 'एजंट',
  'role.viewer': 'निरीक्षक',

  'common.search': 'शोधा',
  'search.placeholder': 'व्यवहार, संपर्क किंवा मालमत्ता शोधा...',
  'common.save': 'जतन करा',
  'common.cancel': 'रद्द करा',
  'common.saving': 'जतन होत आहे…',
  'common.loading': 'लोड होत आहे…',
  'common.signOut': 'साइन आउट',

  'appearance.title': 'देखावा',
  'appearance.language': 'प्रदर्शन भाषा',
  'appearance.languageHelp':
    'तुमच्यासाठी या अ‍ॅपची भाषा. यामुळे तुमच्या ग्राहकांना पाठवल्या जाणाऱ्या संदेशांची भाषा बदलत नाही — ती प्रत्येक संपर्कासाठी आणि खात्यासाठी स्वतंत्रपणे ठरवली जाते.',
  'appearance.languageActive': 'दाखवत आहे',
  'appearance.languageShowNow': 'अ‍ॅप या भाषेत दाखवा:',
  'appearance.languageCap':
    'तुम्ही दोन भाषा ठेवू शकता आणि हेडरमधून त्यांमध्ये बदल करू शकता.',
  'appearance.languageIncomplete':
    'भाषांतर सुरू आहे: अद्याप भाषांतरित न झालेल्या स्क्रीन इंग्रजीतच राहतील.',
  'copilot.askSupport': 'सपोर्ट टीमला विचारा',
  'copilot.supportWhere': 'आमच्या टीमने कुठे उत्तर द्यावे?',
  'copilot.supportPhone': 'WhatsApp नंबर',
  'copilot.supportEmail': 'ईमेल पत्ता',
  'copilot.supportSend': 'सपोर्टला पाठवा',
  'copilot.supportSending': 'पाठवत आहोत…',
  'copilot.supportSent': 'सपोर्ट टीमला पाठवले — संदर्भ',
  'copilot.supportReply': 'आम्ही तुम्हाला उत्तर देऊ —',
  'copilot.featureNoted': 'ConvoReal टीमसाठी फीचर विनंती म्हणून नोंदवले.',
  'inventory.nearMe': 'माझ्या जवळ',
  'inventory.nearYou': 'तुमच्या ठिकाणाजवळचे जुळणारे, या परिघात',
  'inventory.listView': 'यादी दृश्य',
  'inventory.mapView': 'नकाशा दृश्य',
  'inventory.mapNotConfigured': 'नकाशा दृश्य सेट केलेले नाही.',
  'inventory.mapFailed':
    'नकाशा लोड झाला नाही — browser key तपासून पुन्हा प्रयत्न करा.',
  'inventory.mapNone': 'या शोधात नकाशावर लिस्टिंग नाही',
  'inventory.mapped': 'लिस्टिंग नकाशावर',
  'inventory.locationUnavailable': 'या browser-मध्ये लोकेशन उपलब्ध नाही.',
  'inventory.locationDenied':
    'तुमचे लोकेशन मिळाले नाही — लोकेशन परवानगी देऊन पुन्हा प्रयत्न करा.',
  'contacts.allProjects': 'सर्व प्रोजेक्ट',
  'contacts.projectFilter': 'प्रोजेक्टनुसार फिल्टर',
  'copilot.assistant': 'एआय सहाय्यक',
  'copilot.title': 'हेल्पर',
  'copilot.greeting':
    'नमस्कार! मी तुम्हाला अ\u200dॅप दाखवू शकतो किंवा ConvoReal बद्दलच्या प्रश्नांची उत्तरे देऊ शकतो. 👋',
  'copilot.typing': 'टाइप करत आहे…',
  'copilot.placeholder': 'काहीही विचारा…',
  'copilot.guides': 'टप्प्याटप्प्याने मार्गदर्शक',
  'copilot.startTour': 'मला दाखवा — टूर सुरू करा',
  'copilot.openDesktop': 'डेस्कटॉप वेबवर उघडा',
  'copilot.takeMeThere': 'मला तिथे घेऊन चला',
  'copilot.webOnlyHint': 'हे फक्त डेस्कटॉप वेब डॅशबोर्डवर आहे.',
  'copilot.partialHint': 'यात मी फक्त अंशतः मदत करू शकलो.',
  'copilot.helpful': 'उपयुक्त?',
  'copilot.thanks': 'फीडबॅकबद्दल धन्यवाद!',
  'copilot.open': 'हेल्पर उघडा',
  'tour.next': 'पुढे',
  'tour.done': 'झाले',
  'tour.skip': 'वगळा',
  'tour.tapHighlight': 'हायलाइटवर टॅप करा 👆',
};

export const MESSAGES: Record<LanguageCode, Catalogue> = {
  en: EN,
  hi: HI,
  kn: KN,
  ta: TA,
  te: TE,
  ml: ML,
  mr: MR,
};

/** Look up a key, falling back to English for anything untranslated. */
export function translate(language: LanguageCode, key: MessageKey): string {
  return MESSAGES[language]?.[key] ?? EN[key];
}

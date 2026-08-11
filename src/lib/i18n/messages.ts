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
  'appearance.languageIncomplete':
    'Translation is in progress: screens that are not translated yet stay in English.',
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
  'appearance.languageIncomplete':
    'अनुवाद जारी है: जो स्क्रीन अभी अनुवादित नहीं हैं वे अंग्रेज़ी में ही रहेंगी।',
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
  'appearance.languageIncomplete':
    'ಅನುವಾದ ಪ್ರಗತಿಯಲ್ಲಿದೆ: ಇನ್ನೂ ಅನುವಾದಿಸದ ಪರದೆಗಳು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿಯೇ ಇರುತ್ತವೆ.',
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
  'appearance.languageIncomplete':
    'மொழிபெயர்ப்பு நடைபெறுகிறது: இன்னும் மொழிபெயர்க்கப்படாத திரைகள் ஆங்கிலத்திலேயே இருக்கும்.',
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
  'appearance.languageIncomplete':
    'అనువాదం జరుగుతోంది: ఇంకా అనువదించని స్క్రీన్‌లు ఆంగ్లంలోనే ఉంటాయి.',
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
  'appearance.languageIncomplete':
    'വിവർത്തനം പുരോഗമിക്കുന്നു: ഇതുവരെ വിവർത്തനം ചെയ്യാത്ത സ്ക്രീനുകൾ ഇംഗ്ലീഷിൽ തന്നെ തുടരും.',
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
  'appearance.languageIncomplete':
    'भाषांतर सुरू आहे: अद्याप भाषांतरित न झालेल्या स्क्रीन इंग्रजीतच राहतील.',
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

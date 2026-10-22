import type { LanguageCode } from '../languages';

export interface TourStepCopy {
  title: string;
  body: string;
}

export interface TourCopy {
  title: string;
  description: string;
  steps: TourStepCopy[];
  mobileSteps?: TourStepCopy[];
}

interface Localizable {
  id: string;
  title: string;
  description: string;
  steps: { title: string; body: string }[];
}

/**
 * Translated tour copy, keyed by language and tour id. English stays
 * in tours.ts as the source of truth; a tour or language missing here
 * renders in English. Step arrays are positional, so a step added to
 * a tour needs its translation added here too — tour-copy.test.ts
 * fails the build when the counts drift.
 */
export const TOUR_COPY: Partial<
  Record<LanguageCode, Record<string, TourCopy>>
> = {
  hi: {
    'add-contact': {
      title: 'कॉन्टैक्ट जोड़ें',
      description: 'नई लीड या ग्राहक को उनके फ़ोन नंबर के साथ सेव करें',
      steps: [
        {
          title: 'Contacts खोलें',
          body: 'आपकी सभी लीड्स और ग्राहक यहाँ रहते हैं। मेनू में **Contacts** पर क्लिक करें।',
        },
        {
          title: 'अपना कॉन्टैक्ट जोड़ें',
          body: '**Add Contact** बटन पर क्लिक करें।',
        },
        {
          title: 'बस हो गया!',
          body: 'नाम और WhatsApp नंबर भरें, फिर Save दबाएँ। खरीदारों के लिए **Looking to** में Buy, Rent या Either चुनें — इससे उनके मैच सही रहते हैं। बस इतना ही! \u{1F389}',
        },
      ],
      mobileSteps: [
        {
          title: 'अपना कॉन्टैक्ट जोड़ें',
          body: 'यह **Add contact** बटन है — नई लीड सेव करने के लिए इसे टैप करें।',
        },
      ],
    },
    'add-property': {
      title: 'प्रॉपर्टी जोड़ें',
      description: 'कीमत, लोकेशन और फ़ोटो के साथ नई प्रॉपर्टी लिस्ट करें',
      steps: [
        {
          title: 'Inventory खोलें',
          body: 'आपकी प्रॉपर्टीज़ **Inventory** में रहती हैं। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'अपनी प्रॉपर्टी जोड़ें',
          body: '**Add Property** बटन पर क्लिक करें।',
        },
        {
          title: 'बस हो गया!',
          body: 'कीमत, लोकेशन और फ़ोटो जोड़ें, फिर Save दबाएँ। खरीदार वही देखते हैं जो आप यहाँ भरते हैं।',
        },
      ],
    },
    'connect-whatsapp': {
      title: 'WhatsApp जोड़ें',
      description:
        'चैट और ब्रॉडकास्ट शुरू करने के लिए अपना WhatsApp Business नंबर लिंक करें',
      steps: [
        {
          title: 'Settings खोलें',
          body: 'WhatsApp सेटअप **Settings** में है। मेनू के नीचे इस पर क्लिक करें।',
        },
        {
          title: 'WhatsApp टैब पर जाएँ',
          body: '**WhatsApp** टैब पर क्लिक करें।',
        },
        {
          title: 'अपनी जानकारी भरें',
          body: 'अपने Meta Business अकाउंट की जानकारी यहाँ भरें, फिर Save दबाएँ। जुड़ने के बाद हर ग्राहक का संदेश आपके Inbox में आता है।',
        },
      ],
    },
    'send-broadcast': {
      title: 'ब्रॉडकास्ट भेजें',
      description: 'एक WhatsApp संदेश एक साथ कई कॉन्टैक्ट्स को भेजें',
      steps: [
        {
          title: 'Broadcasts खोलें',
          body: 'एक संदेश कई लोगों को **Broadcasts** से भेजें। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'नया ब्रॉडकास्ट शुरू करें',
          body: '**New Broadcast** पर क्लिक करें।',
        },
        {
          title: 'बस ये स्टेप्स फ़ॉलो करें',
          body: 'ये 3 स्टेप्स फ़ॉलो करें — संदेश लिखें, लोग चुनें और भेजें। ConvoReal आपके लिए अप्रूव्ड WhatsApp टेम्पलेट खुद चुन लेता है, इसलिए कुछ चुनना नहीं पड़ता।',
        },
      ],
      mobileSteps: [
        {
          title: 'नया ब्रॉडकास्ट शुरू करें',
          body: 'ऊपर **New broadcast** टैप करें।',
        },
        {
          title: 'बस ये स्टेप्स फ़ॉलो करें',
          body: 'संदेश लिखें, लोग चुनें और भेजें। ConvoReal आपके लिए अप्रूव्ड WhatsApp टेम्पलेट खुद चुन लेता है, इसलिए कुछ चुनना नहीं पड़ता।',
        },
      ],
    },
    'submit-templates': {
      title: 'अपने तैयार टेम्पलेट इस्तेमाल करें',
      description:
        'पहले से लोड WhatsApp टेम्पलेट Meta को भेजें और देखें वे आपके लिए कहाँ काम करते हैं',
      steps: [
        {
          title: 'Settings खोलें',
          body: 'टेम्पलेट **Settings** में रहते हैं। मेनू के नीचे इस पर क्लिक करें।',
        },
        {
          title: 'WhatsApp टैब पर जाएँ',
          body: '**WhatsApp** टैब पर क्लिक करें।',
        },
        {
          title: 'Templates खोलें',
          body: '**Templates** टैब पर क्लिक करें।',
        },
        {
          title: 'आपके तैयार टेम्पलेट',
          body: 'ये आपके अकाउंट के साथ पहले से आए हैं। जो **Draft** दिख रहा है वह अभी Meta को नहीं गया — उसे खोलकर **Submit for approval** दबाएँ। अप्रूव होने पर अपॉइंटमेंट और साइट विज़िट रिमाइंडर अपने आप जाते हैं, और Broadcasts उन्हें इस्तेमाल कर सकते हैं। ✅',
        },
      ],
    },
    'email-lead-sync': {
      title: 'पोर्टल लीड्स ईमेल से पाएँ',
      description:
        '99acres, MagicBricks और Housing की लीड ईमेल अपने आप ConvoReal में लाएँ',
      steps: [
        {
          title: 'Settings खोलें',
          body: 'ईमेल लीड सेटअप **Settings** में है। मेनू के नीचे इस पर क्लिक करें।',
        },
        {
          title: 'Other टैब पर जाएँ',
          body: '**Other** टैब पर क्लिक करें।',
        },
        {
          title: 'आपका लीड फ़ॉरवर्डिंग पता',
          body: 'यह पता कॉपी करें, फिर अपने Gmail या Outlook में 99acres, MagicBricks या Housing की ईमेल के लिए फ़ॉरवर्डिंग नियम जोड़ें — स्टेप-बाय-स्टेप गाइड ठीक नीचे है। नियम लगते ही हर पोर्टल लीड अपने आप WhatsApp कॉन्टैक्ट बन जाती है। \u{1F4E9}',
        },
      ],
    },
    'check-property-views': {
      title: 'देखें किसने आपकी प्रॉपर्टी देखी',
      description: 'अपने प्रॉपर्टी लिंक पर विज़िटर गतिविधि देखें (Pulse)',
      steps: [
        {
          title: 'Dashboard खोलें',
          body: 'चलिए आपकी विज़िटर गतिविधि देखते हैं। मेनू में **Dashboard** पर क्लिक करें।',
        },
        {
          title: 'Pulse खोलें',
          body: '**Pulse** टैब पर क्लिक करें।',
        },
        {
          title: 'आपकी विज़िटर गतिविधि',
          body: 'जब भी कोई WhatsApp पर आपका प्रॉपर्टी लिंक खोलता है, वह यहाँ दिखता है — कुल व्यूज़, बिताया समय और आपकी सबसे लोकप्रिय प्रॉपर्टीज़। \u{1F440}',
        },
      ],
      mobileSteps: [
        {
          title: 'आपकी विज़िटर गतिविधि',
          body: 'जब भी कोई WhatsApp पर आपका प्रॉपर्टी लिंक खोलता है, वह यहाँ दिखता है — कुल व्यूज़, बिताया समय और आपकी सबसे लोकप्रिय प्रॉपर्टीज़। \u{1F440}',
        },
      ],
    },
    'share-requirement': {
      title: 'दूसरे ब्रोकर के साथ रिक्वायरमेंट शेयर करें',
      description:
        'क्लाइंट की रिक्वायरमेंट दूसरे एजेंटों को भेजें और मैचिंग लिस्टिंग वापस पाएँ',
      steps: [
        {
          title: 'Contacts खोलें',
          body: 'क्लाइंट रिक्वायरमेंट **Contacts** के अंदर रहती हैं। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'Requirements पर जाएँ',
          body: 'हर क्लाइंट ब्रीफ़ देखने के लिए **Requirements** टैब पर क्लिक करें।',
        },
        {
          title: 'ब्रीफ़ शेयर करें',
          body: 'किसी भी रिक्वायरमेंट कार्ड पर **share** आइकन क्लिक करें। कई एक साथ भेजने के लिए पहले कार्ड टिक करें और ऊपर **Share with brokers** इस्तेमाल करें।',
        },
        {
          title: 'Masked या पूरी जानकारी?',
          body: '**Masked** सुरक्षित डिफ़ॉल्ट है — दूसरा ब्रोकर बजट और इलाका REQ-A3F2 जैसे कोड के नीचे देखता है, आपके क्लाइंट का नाम या आपके नोट्स कभी नहीं। **Full detail** सिर्फ़ अपनी फ़र्म के किसी व्यक्ति के लिए चुनें।',
        },
        {
          title: 'भेजें और लिस्टिंग इकट्ठा करें',
          body: '**Interactive response links** चालू रखें, फिर **Send on WhatsApp** दबाएँ। ब्रोकर को एक लिंक मिलता है जिससे वे आपको मैचिंग प्रॉपर्टी भेज सकते हैं — वह Inventory में **Review** के नीचे आपकी मंज़ूरी के लिए आती है। \u{1F91D}',
        },
      ],
    },
    'set-up-showcase': {
      title: 'अपना पब्लिक Showcase सेट करें',
      description:
        'अपनी एजेंसी की स्टाइल चुनें और हर पब्लिक लिस्टिंग पेज पर सेवाएँ जोड़ें',
      steps: [
        {
          title: 'Settings खोलें',
          body: 'आपका पब्लिक Showcase **Settings** में सेट होता है। मेनू के नीचे इस पर क्लिक करें।',
        },
        {
          title: 'Showcase खोलें',
          body: 'अपने प्रॉपर्टी लिंक के पीछे का पब्लिक पेज संपादित करने के लिए **Showcase** पर क्लिक करें।',
        },
        {
          title: 'अपनी पब्लिक स्टाइल चुनें',
          body: 'General सेक्शन से शुरू करें: अपनी ब्रांडिंग सेट करें और वह Showcase स्टाइल चुनें जो आपकी एजेंसी पर सबसे अच्छी लगे।',
        },
        {
          title: 'अपनी सेवाएँ जोड़ें',
          body: 'अपनी एजेंसी की सेवाएँ जोड़ने के लिए **Services** पर क्लिक करें। वे आपके पब्लिक Showcase पेज पर दिखती हैं।',
        },
        {
          title: 'लिस्टिंग से आगे भरोसा बनाएँ',
          body: 'अपनी सेवाएँ यहाँ जोड़ें। पास का **Articles** टैब मार्केट अपडेट और एजेंसी की खबरों के लिए वैसे ही काम करता है।',
        },
      ],
    },
    'set-bot-rules': {
      title: 'बॉट जवाब के नियम सेट करें',
      description: 'WhatsApp बॉट को बताएं कि उसे कैसे जवाब देना चाहिए',
      steps: [
        {
          title: 'Settings खोलें',
          body: 'बॉट जवाब के नियम **Settings** में रहते हैं। मेनू के नीचे इस पर क्लिक करें।',
        },
        {
          title: 'Bot Rules खोलें',
          body: 'Workspace सेक्शन में **Bot Rules** पर क्लिक करें।',
        },
        {
          title: 'बॉट को एक साफ़ निर्देश दें',
          body: 'एक साफ़ निर्देश लिखें, चुनें कि वह कहाँ लागू हो, फिर उसे सक्रिय जोड़ें। नियम सिर्फ़ जवाबों को दिशा देते हैं — वे खुद कभी नया संदेश नहीं भेजते।',
        },
      ],
    },
    'review-conversation-gaps': {
      title: 'बातचीत की कमियाँ देखें',
      description: 'देखें कल की WhatsApp बातचीत में क्या छूट गया हो सकता है',
      steps: [
        {
          title: 'Dashboard खोलें',
          body: 'आपकी रोज़ की बातचीत समीक्षा **Dashboard** पर है। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'Gaps खोलें',
          body: 'कल की बातचीत में क्या अधूरा रह गया, देखने के लिए **Gaps** टैब पर क्लिक करें।',
        },
        {
          title: 'जिस पर ध्यान चाहिए, उसे निपटाएँ',
          body: 'हर सुबह ConvoReal पिछले दिन की WhatsApp बातचीत की समीक्षा करता है। पहले ज़रूरी आइटम खोलें, फिर हर एक को पूरा करें या हटाएँ — यह स्क्रीन खुद कभी संदेश नहीं भेजती।',
        },
      ],
    },
    'use-inbox': {
      title: 'Inbox में ग्राहकों को जवाब दें',
      description:
        'हर WhatsApp चैट एक जगह पाएँ, जिन्हें जवाब चाहिए उन्हें फ़िल्टर करें और जवाब दें',
      steps: [
        {
          title: 'Inbox खोलें',
          body: 'ग्राहक के साथ हर WhatsApp चैट **Inbox** में आती है। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'आपकी बातचीत',
          body: 'सबसे नई चैट ऊपर हैं और बिना पढ़ी चैट हाइलाइट हैं। जिन चैट को अभी जवाब चाहिए उन्हें खोजने के लिए सर्च बॉक्स और लिस्ट के ऊपर के फ़िल्टर इस्तेमाल करें।',
        },
        {
          title: 'चैट खोलें और जवाब दें',
          body: 'कोई भी चैट क्लिक करके पढ़ें और नीचे अपना जवाब लिखें। ग्राहक के आखिरी संदेश के 24 घंटे के अंदर आप कुछ भी लिख सकते हैं; उसके बाद अप्रूव्ड टेम्पलेट चुनें और उनके जवाब देते ही चैट फिर खुल जाती है। \u{1F4AC}',
        },
      ],
      mobileSteps: [
        {
          title: 'आपकी बातचीत',
          body: 'ग्राहक के साथ हर WhatsApp चैट यहाँ आती है, सबसे नई पहले। किसी को जल्दी ढूँढने के लिए नाम, फ़ोन या संदेश से खोजें।',
        },
        {
          title: 'जिन्हें जवाब चाहिए, उन्हें ढूँढें',
          body: 'सिर्फ़ आपके इंतज़ार वाली चैट देखने के लिए **Needs reply** या **Unread** टैप करें, फिर चैट खोलकर नीचे अपना जवाब लिखें। \u{1F4AC}',
        },
      ],
    },
    'track-deals': {
      title: 'बोर्ड पर डील ट्रैक करें',
      description:
        'खरीदार के लिए डील जोड़ें और आगे बढ़ने पर उसे पाइपलाइन स्टेज में आगे ले जाएँ',
      steps: [
        {
          title: 'Transactions खोलें',
          body: 'डील्स **Transactions** के नीचे पाइपलाइन बोर्ड पर रहती हैं। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'डील जोड़ें',
          body: 'खरीदार और प्रॉपर्टी को बोर्ड पर लाने के लिए **Add Deal** पर क्लिक करें।',
        },
        {
          title: 'आगे बढ़ने पर उसे आगे ले जाएँ',
          body: 'कॉन्टैक्ट, प्रॉपर्टी और स्टेज चुनें, फिर Save दबाएँ। डील आगे बढ़े तो कार्ड को स्टेज के बीच ड्रैग करें — जर्नी मैप और क्लोज़िंग रिकॉर्ड अपने आप साथ चलते हैं। \u{1F4CB}',
        },
      ],
      mobileSteps: [
        {
          title: 'आपकी पाइपलाइन स्टेज',
          body: 'हर स्टेज दिखाती है कि उसमें कितनी डील हैं और उनकी वैल्यू क्या है। उसके कार्ड पर जाने के लिए स्टेज टैप करें।',
        },
        {
          title: 'डील जोड़ें',
          body: 'खरीदार और प्रॉपर्टी को बोर्ड पर लाने के लिए **+** टैप करें। बाद में किसी कार्ड को अगली स्टेज में ले जाने के लिए उसे देर तक दबाएँ।',
        },
      ],
    },
    'schedule-visit': {
      title: 'साइट विज़िट शेड्यूल करें',
      description:
        'कैलेंडर पर साइट विज़िट या मीटिंग बुक करें, WhatsApp रिमाइंडर अपने आप जाते हैं',
      steps: [
        {
          title: 'Calendar खोलें',
          body: 'साइट विज़िट और मीटिंग **Calendar** पर रहती हैं। मेनू में इस पर क्लिक करें।',
        },
        {
          title: 'शेड्यूल करें',
          body: 'अपॉइंटमेंट फ़ॉर्म खोलने के लिए **Schedule** पर क्लिक करें।',
        },
        {
          title: 'रिमाइंडर अपने आप जाते हैं',
          body: 'कॉन्टैक्ट, प्रॉपर्टी, तारीख और समय चुनें, फिर Save दबाएँ। ग्राहक को विज़िट से पहले WhatsApp रिमाइंडर अपने आप मिलता है, और उनका जवाब आपके Inbox में आता है। \u{1F4C5}',
        },
      ],
      mobileSteps: [
        {
          title: 'विज़िट शेड्यूल करें',
          body: 'साइट विज़िट या मीटिंग बुक करने के लिए **+** टैप करें।',
        },
        {
          title: 'रिमाइंडर अपने आप जाते हैं',
          body: 'कॉन्टैक्ट, प्रॉपर्टी, तारीख और समय चुनें, फिर सेव करें। ग्राहक को विज़िट से पहले WhatsApp रिमाइंडर अपने आप मिलता है। \u{1F4C5}',
        },
      ],
    },
    'invite-team': {
      title: 'टीम के साथी को आमंत्रित करें',
      description:
        'अपने वर्कस्पेस में एजेंट या एडमिन जोड़ें ताकि वे वही Inbox और Inventory इस्तेमाल कर सकें',
      steps: [
        {
          title: 'Settings खोलें',
          body: 'आपकी टीम **Settings** में संभाली जाती है। मेनू के नीचे इस पर क्लिक करें।',
        },
        {
          title: 'Members पर जाएँ',
          body: '**Members** टैब पर क्लिक करें।',
        },
        {
          title: 'साथी को आमंत्रित करें',
          body: '**Invite member** पर क्लिक करें। यह बटन सिर्फ़ ओनर और एडमिन को दिखता है।',
        },
        {
          title: 'उनकी भूमिका चुनें',
          body: 'उनका ईमेल भरें, भूमिका चुनें — **Agent** कॉन्टैक्ट, प्रॉपर्टी और चैट संभालता है; **Admin** टीम भी संभालता है — और भेजें। उन्हें आपके वर्कस्पेस से जुड़ने का लिंक मिलता है। \u{1F91D}',
        },
      ],
    },
  },
};

export function tourCopyFor(
  tourId: string,
  language: LanguageCode
): TourCopy | undefined {
  return TOUR_COPY[language]?.[tourId];
}

function mergeSteps<S extends { title: string; body: string }>(
  steps: S[],
  copy: TourStepCopy[] | undefined
): S[] {
  if (!copy || copy.length !== steps.length) return steps;
  return steps.map((step, i) => ({ ...step, ...copy[i] }));
}

/** The web tour with its title, description and steps in `language`. */
export function localizeTour<T extends Localizable>(
  tour: T,
  language: LanguageCode
): T {
  const copy = tourCopyFor(tour.id, language);
  if (!copy) return tour;
  return {
    ...tour,
    title: copy.title,
    description: copy.description,
    steps: mergeSteps(tour.steps, copy.steps),
  };
}

/** The app's tour (whose steps are the registry's mobileSteps) in `language`. */
export function localizeMobileTour<T extends Localizable>(
  tour: T,
  language: LanguageCode
): T {
  const copy = tourCopyFor(tour.id, language);
  if (!copy) return tour;
  return {
    ...tour,
    title: copy.title,
    description: copy.description,
    steps: mergeSteps(tour.steps, copy.mobileSteps),
  };
}

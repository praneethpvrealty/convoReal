import { generateJsonFromParts, type GeminiPart } from '@/lib/ai/gemini';
import { parseJsonResponse } from '@/lib/invoices/document-extract';

import { isScheduleMimeType, sanitiseSchedule } from './schedule-fields';
import type { PropertySchedule } from './types';

export {
  SCHEDULE_MAX_BYTES,
  isScheduleMimeType,
  sanitiseSchedule,
} from './schedule-fields';

const SCHEDULE_INSTRUCTIONS = `
You are reading one of two Indian (usually Karnataka) property documents:
  - the SCHEDULE of a sale deed: the paragraph that describes the
    property, its location, extent and boundaries; or
  - an RTC (Record of Rights, Tenancy and Crops, also called Pahani or
    ಪಹಣಿ), the Kannada land record from Bhoomi.
Return JSON with these keys where the document clearly shows them:
  document_type     "sale_deed" or "rtc"
  state             the Indian state; infer "Karnataka" only from a
                    Karnataka city or district named in the text
  district          e.g. "Bengaluru Urban"; a schedule that says only
                    "Bangalore" / "Bengaluru" city is "Bengaluru Urban"
  taluk             taluk name
  hobli             hobli name
  village           revenue village name
  village_local     the village exactly as printed, in its own script
                    (for an RTC, the Kannada name without the code)
  city              city or town
  locality          the area, layout, extension or block the property is
                    in, e.g. "Koramangala 6th Block", without the road
  road              the street or road, e.g. "18th Main", without the area
  pincode           6-digit PIN code
  municipal_number  municipal / corporation / door number
  pid               the PID number
  survey_number     survey number(s) as printed
  khata_number      khata or assessment number
  kind              "site" (vacant plot), "house" (land and building),
                    "apartment" (flat / unit), "agricultural", "commercial"
                    or "industrial"
  usage             "residential", "commercial", "industrial" or
                    "agricultural"
  land_area         {"value": number, "unit": "sqft"|"sqm"|"acre"|"gunta"|"hectare"}
                    the extent of land or site; for "A acres B guntas"
                    convert to guntas (1 acre = 40 guntas)
  extent_printed    the extent exactly as printed, e.g. "2.10.00"
  built_up_area     {"value": number, "unit": ...} the total built-up or
                    super built-up area of the building or flat
  floors            array of {"label": string, "area": {"value", "unit"}}
                    when the schedule lists floor-wise areas
  boundaries        {"east", "west", "north", "south"} as printed
  summary           one sentence describing the property in plain English

For an RTC:
  - Read the header labels: ಜಿಲ್ಲೆ district, ತಾಲ್ಲೂಕು taluk, ಹೋಬಳಿ hobli,
    ಗ್ರಾಮ village. A village is printed with its code, e.g.
    "110-ಅಡ್ಡೂರು": drop the code. When the district is not printed,
    name the district the taluk belongs to.
  - Transliterate Kannada names letter by letter in the usual Karnataka
    spelling: keep doubled consonants and long vowels (ಅಡ್ಡೂರು is
    "Adduru", ಗುರುಪುರ is "Gurupura"). Never replace a name with a
    different place you recognise that sounds similar.
  - survey_number is the ಸರ್ವೆ ನಂಬರು followed by the ಹಿಸ್ಸಾ, e.g. "6/32".
  - The land is agricultural unless the RTC records a conversion.
  - The ವಿಸ್ತೀರ್ಣ (extent) is printed under column headers such as
    ಎಕರೆ (acre), ಗುಂಟೆ (gunta) and ಆಣೆ (anna, 16 annas = 1 gunta).
    Always fill extent_printed. Fill land_area only when the headers
    make every part's unit certain, converting to guntas; otherwise leave
    land_area out.

Return ONLY valid JSON. Omit a key rather than guessing. Never compute a
land area from dimensions that are not printed, and never treat a
built-up area as the land extent.`;

export async function extractSchedule(input: {
  buffer: Uint8Array;
  mimeType: string;
}): Promise<PropertySchedule> {
  if (!isScheduleMimeType(input.mimeType)) {
    throw new Error(`Cannot read a ${input.mimeType || 'file'} of this type.`);
  }
  const parts: GeminiPart[] = [
    {
      inlineData: {
        mimeType: input.mimeType,
        data: Buffer.from(input.buffer).toString('base64'),
      },
    },
    {
      text: 'Transcribe this sale deed schedule or RTC into the JSON described.',
    },
  ];
  const response = await generateJsonFromParts(parts, SCHEDULE_INSTRUCTIONS, {
    feature: 'guidance_value_lookup',
  });
  return sanitiseSchedule(parseJsonResponse(response));
}

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
You are reading the SCHEDULE of an Indian (usually Karnataka) sale deed:
the paragraph that describes the property, its location, extent and
boundaries. Return JSON with these keys where the text clearly shows them:
  state             the Indian state; infer "Karnataka" only from a
                    Karnataka city or district named in the text
  district          e.g. "Bengaluru Urban"; a schedule that says only
                    "Bangalore" / "Bengaluru" city is "Bengaluru Urban"
  taluk             taluk name
  hobli             hobli name
  village           revenue village name
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
  built_up_area     {"value": number, "unit": ...} the total built-up or
                    super built-up area of the building or flat
  floors            array of {"label": string, "area": {"value", "unit"}}
                    when the schedule lists floor-wise areas
  boundaries        {"east", "west", "north", "south"} as printed
  summary           one sentence describing the property in plain English

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
    { text: 'Transcribe this sale deed schedule into the JSON described.' },
  ];
  const response = await generateJsonFromParts(parts, SCHEDULE_INSTRUCTIONS, {
    feature: 'guidance_value_lookup',
  });
  return sanitiseSchedule(parseJsonResponse(response));
}

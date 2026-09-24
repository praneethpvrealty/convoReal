import { generateJsonFromParts, type GeminiPart } from '@/lib/ai/gemini';
import { parseJsonResponse } from '@/lib/invoices/document-extract';

import {
  isEKhataMimeType,
  sanitiseEKhata,
  type EKhataFields,
} from './e-khata-fields';

const E_KHATA_INSTRUCTIONS = `
You are reading a Karnataka e-Khata: the municipal property record (Form-A
or Form-B) issued by BBMP, a Bengaluru city corporation or another urban
local body. Return JSON with these keys where the document clearly shows
them:
  epid               the New ePID number of the property, digits only
  khata_form         "A" or "B" from "Property Classification: Form-A/Form-B"
  document_number    the Document No.
  document_date      the date the document was issued, as YYYY-MM-DD.
                     Dates on this form are printed month/day/year.
  corporation        the issuing corporation or urban local body
  ward               the new ward name
  property_number    the Property No.
  address            the property address on one line, exactly as printed
  pincode            the 6-digit PIN code of the property address
  latitude           decimal degrees
  longitude          decimal degrees
  site_dimensions_ft {"east_west": number, "north_south": number} in FEET
                     as printed (the part after the "/" when metres and
                     feet are both given)
  site_area_sqft     the site area in square feet as printed
  ownership_type     the type of property ownership, e.g. "Site with
                     Building", "Vacant Site", "Flat"
  floors             array of {"floor": string|null, "area_sqft": number,
                     "occupancy": string|null, "year_built": number|null}
                     from the building details, area in square feet
  owners             array of the owners' names only
  boundaries         {"north", "east", "west", "south"} from the schedule
  tax_year           the latest property tax paid assessment year
  tax_paid           the property tax amount paid, a plain number
  liabilities        the liabilities text as printed

Never return an identification document number, Aadhaar number, phone
number or photograph. Return ONLY valid JSON. Omit a key rather than
guessing, and transcribe rather than tidy up.`;

export async function extractEKhata(input: {
  buffer: Uint8Array;
  mimeType: string;
}): Promise<EKhataFields> {
  if (!isEKhataMimeType(input.mimeType)) {
    throw new Error(`Cannot read a ${input.mimeType || 'file'} of this type.`);
  }
  const parts: GeminiPart[] = [
    {
      inlineData: {
        mimeType: input.mimeType,
        data: Buffer.from(input.buffer).toString('base64'),
      },
    },
    { text: 'Transcribe this e-Khata into the JSON described.' },
  ];
  const response = await generateJsonFromParts(parts, E_KHATA_INSTRUCTIONS, {
    feature: 'e_khata_read',
  });
  return sanitiseEKhata(parseJsonResponse(response));
}

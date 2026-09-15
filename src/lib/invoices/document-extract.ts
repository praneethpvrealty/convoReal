/**
 * Reading a deal document with AI.
 *
 * A closing arrives as photographs: an Aadhaar card, a PAN card, the
 * previous sale deed. The invoice needs the buyer's name and address off
 * the first of those, and today someone retypes it.
 *
 * Two rules shape everything here.
 *
 * The first is that the full Aadhaar number never leaves the file. The
 * prompt asks for the last four digits and `sanitiseExtraction` strips
 * anything that looks like a full one even if the model returns it
 * anyway — because a model instruction is a request, not a control.
 * Aadhaar (Targeted Delivery of Financial and Other Subsidies, Benefits
 * and Services) Act s.29(4) restricts publishing an Aadhaar number, and
 * the practical point stands on its own: a number in a column ends up in
 * backups, logs and query results, whereas a number in a private
 * document stays in the private document.
 *
 * The second is that extraction proposes and never writes. The caller
 * stores this on `deal_documents.extracted`; an agent applies fields
 * one at a time. A misread digit in an address is a correction; a
 * misread digit written straight onto an issued invoice is a reissue.
 */

import { generateJsonFromParts, type GeminiPart } from '@/lib/ai/gemini';

import type { DealDocumentCategory, ExtractedDocumentFields } from './types';

const IDENTITY_INSTRUCTIONS = `
You are reading an Indian identity document (Aadhaar, PAN card or passport).
Return JSON with these keys where the document clearly shows them:
  document_type          "aadhaar" | "pan" | "passport" | "other"
  name                   the holder's full name exactly as printed
  address_lines          array of address lines, in the order printed
  state_name             the Indian state
  pincode                the 6-digit PIN code
  pan                    the 10-character PAN, if this is a PAN card
  aadhaar_last4          ONLY the last four digits of the Aadhaar number
  father_or_spouse_name  if printed
  date_of_birth          as YYYY-MM-DD if printed

CRITICAL: never return the full Aadhaar number. Return only its last four
digits in aadhaar_last4. Do not place the full number in any other field.`;

const PROPERTY_INSTRUCTIONS = `
You are reading an Indian property document (sale deed, sale agreement,
khata, or encumbrance certificate).
Return JSON with these keys where the document clearly shows them:
  document_type     "sale_deed" | "agreement" | "khata" | "ec" | "other"
  parties           array of the full names of the parties
  address_lines     array of the property address lines
  state_name        the Indian state
  pincode           the 6-digit PIN code
  survey_number     survey / plot number
  khata_number      khata or assessment number
  extent            the site extent as printed, e.g. "1200 Sq.Ft."
  document_number   the registration or document number
  document_date     as YYYY-MM-DD
  consideration     the consideration amount as a plain number, no commas
  notes             anything important that has no field above`;

const SHARED_RULES = `
Return ONLY valid JSON. Omit a key entirely rather than guessing: a
missing field is corrected in one keystroke, a wrong one is signed off
and printed. Do not infer, translate or tidy up what is written —
transcribe it.`;

export function instructionsFor(category: DealDocumentCategory): string {
  const base =
    category === 'identity' ? IDENTITY_INSTRUCTIONS : PROPERTY_INSTRUCTIONS;
  return `${base}\n${SHARED_RULES}`;
}

/** Anything with 12 digits in it, however it has been spaced or split. */
const AADHAAR_SHAPED = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

/** Digits only, for comparing what a model returned against a real number. */
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function cleanString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || undefined;
}

function cleanLines(value: unknown, maxLines = 6): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value
    .map((line) => cleanString(line))
    .filter((line): line is string => Boolean(line))
    .slice(0, maxLines);
  return lines.length ? lines : undefined;
}

/**
 * Remove any full Aadhaar number the model returned despite the prompt,
 * from every string field.
 *
 * This is the backstop, not the control: the prompt asks, this enforces.
 * A number is replaced with a masked form rather than deleted, so an
 * agent proofreading the address can still see that a line held one.
 */
export function redactAadhaarNumbers(text: string): string {
  return text.replace(AADHAAR_SHAPED, (match) => {
    const raw = digits(match);
    return raw.length === 12 ? `XXXX XXXX ${raw.slice(-4)}` : match;
  });
}

/**
 * Coerce whatever the model returned into the shape the UI expects.
 *
 * Every field is validated rather than trusted: a PAN that is not a PAN
 * or a pincode that is not six digits is dropped, because a field the
 * agent has to check is worth less than no field at all.
 */
export function sanitiseExtraction(raw: unknown): ExtractedDocumentFields {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: ExtractedDocumentFields = {};

  const documentType = cleanString(input.document_type, 40);
  if (documentType) out.document_type = documentType.toLowerCase();

  const name = cleanString(input.name);
  if (name) out.name = redactAadhaarNumbers(name);

  const addressLines = cleanLines(input.address_lines);
  if (addressLines) out.address_lines = addressLines.map(redactAadhaarNumbers);

  const stateName = cleanString(input.state_name, 60);
  if (stateName) out.state_name = stateName;

  const pincode = cleanString(input.pincode, 12);
  if (pincode && /^[1-9]\d{5}$/.test(digits(pincode))) {
    out.pincode = digits(pincode);
  }

  const pan = cleanString(input.pan, 20)?.toUpperCase().replace(/\s/g, '');
  if (pan && /^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) out.pan = pan;

  // Only ever four digits, whatever arrived.
  const last4 = cleanString(input.aadhaar_last4, 20);
  if (last4) {
    const onlyDigits = digits(last4);
    if (onlyDigits.length >= 4) out.aadhaar_last4 = onlyDigits.slice(-4);
  }

  const relation = cleanString(input.father_or_spouse_name);
  if (relation) out.father_or_spouse_name = redactAadhaarNumbers(relation);

  const dob = cleanString(input.date_of_birth, 20);
  if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) out.date_of_birth = dob;

  const parties = cleanLines(input.parties, 10);
  if (parties) out.parties = parties.map(redactAadhaarNumbers);

  for (const key of [
    'survey_number',
    'khata_number',
    'extent',
    'document_number',
  ] as const) {
    const value = cleanString(input[key], 80);
    if (value) out[key] = redactAadhaarNumbers(value);
  }

  const documentDate = cleanString(input.document_date, 20);
  if (documentDate && /^\d{4}-\d{2}-\d{2}$/.test(documentDate)) {
    out.document_date = documentDate;
  }

  const consideration = Number(
    typeof input.consideration === 'string'
      ? input.consideration.replace(/[^\d.]/g, '')
      : input.consideration
  );
  if (Number.isFinite(consideration) && consideration > 0) {
    out.consideration = consideration;
  }

  const notes = cleanString(input.notes, 600);
  if (notes) out.notes = redactAadhaarNumbers(notes);

  return out;
}

/** Gemini accepts a PDF or an image as inline data; both arrive here. */
export function isExtractableMimeType(
  mimeType: string | null | undefined
): boolean {
  const type = (mimeType ?? '').toLowerCase();
  return (
    type === 'application/pdf' ||
    type === 'image/jpeg' ||
    type === 'image/png' ||
    type === 'image/webp'
  );
}

export interface ExtractDocumentInput {
  buffer: Uint8Array;
  mimeType: string;
  category: DealDocumentCategory;
}

/**
 * Read one document and return the proposed fields.
 *
 * The caller burns credits BEFORE calling this and refunds on a throw —
 * the ordering the credit engine requires (see `src/lib/credits/burn.ts`).
 */
export async function extractDocumentFields(
  input: ExtractDocumentInput
): Promise<ExtractedDocumentFields> {
  if (!isExtractableMimeType(input.mimeType)) {
    throw new Error(`Cannot read a ${input.mimeType || 'file'} of this type.`);
  }

  const parts: GeminiPart[] = [
    {
      inlineData: {
        mimeType: input.mimeType,
        data: Buffer.from(input.buffer).toString('base64'),
      },
    },
    { text: 'Transcribe this document into the JSON described.' },
  ];

  const response = await generateJsonFromParts(
    parts,
    instructionsFor(input.category)
  );

  return sanitiseExtraction(parseJsonResponse(response));
}

/** Models sometimes wrap JSON in a fence despite JSON mode. */
export function parseJsonResponse(response: string): unknown {
  const text = String(response ?? '').trim();
  if (!text) return {};
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) return {};
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return {};
    }
  }
}

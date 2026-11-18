/**
 * The short reference the showcase's WhatsApp button adds to its
 * prefilled message when the visitor arrived on a personalized link.
 * It is the start of the browser's showcase session key, and it is the
 * only thing that ties the WhatsApp message a visitor sends to the
 * session they tapped from: the tap is recorded against that session,
 * the message arrives from a phone number the showcase has never seen.
 * Pure, so the showcase page and the inbound chain share one format.
 */
const REF_LENGTH = 8;
const REF_RE = /\(Ref ([0-9a-f]{8})\)/i;

export function enquiryRefSuffix(sessionKey: string): string {
  const ref = sessionKey.trim().slice(0, REF_LENGTH).toLowerCase();
  return /^[0-9a-f]{8}$/.test(ref) ? ` (Ref ${ref})` : '';
}

export function parseEnquiryRef(
  text: string | null | undefined
): string | null {
  return (text || '').match(REF_RE)?.[1].toLowerCase() ?? null;
}

export const REFERRAL_CLOSED_MESSAGE =
  'For more details on this property, please speak with the person who shared it with you.';

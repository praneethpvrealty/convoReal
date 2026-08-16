/**
 * The stand-in name a portal lead is saved under when its email carried
 * no usable one — Housing masks some inquirers as "Housing User", and a
 * parse can come back with the builder's name or nothing at all. The
 * number is the part that matters and cannot be recovered by hand once
 * discarded, so the lead is kept under a placeholder and left in
 * pending_review for an agent to correct.
 *
 * What the placeholder must never be is a greeting. "Hi Portal Lead,
 * thanks for your interest" reached a real buyer on 16 July, and the
 * property-alert template would have addressed them as "Hi Portal,"
 * — it greets on the first word.
 */

export const PORTAL_LEAD_PLACEHOLDER = 'Portal Lead';

/** The placeholder to file a lead under, named after its portal. */
export function placeholderLeadName(source?: string | null): string {
  return source && source !== 'Others' ? `${source} Lead` : PORTAL_LEAD_PLACEHOLDER;
}

const PORTAL = 'portal|housing|99acres|magic\\s*bricks|others';
// Two kinds of stand-in reach this: the one we mint above, and the one the
// portal sent us in the first place. Housing masks its inquirers as
// "Housing User", which the parser now rejects on its way in — but rows
// saved before that guard existed are still in the book, and the alert
// template greets on the first word, so one of them is a "Hi Housing,"
// waiting to happen.
const PLACEHOLDER_NAME = new RegExp(
  `^(?:(?:${PORTAL})\\s+(?:lead|user)|user|unknown|guest|customer|anonymous)$`,
  'i',
);

/** Whether this name is a placeholder rather than a person. Blank counts:
 *  callers use this to decide what to greet, and "Hi ," is no better. */
export function isPlaceholderLeadName(name?: string | null): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  return PLACEHOLDER_NAME.test(trimmed);
}

/** First name for a greeting, or nothing when the lead is filed under a
 *  placeholder. Empty means "greet without a name". */
export function leadFirstName(name?: string | null): string {
  const raw = (name ?? '').trim();
  if (isPlaceholderLeadName(raw)) return '';
  return raw.split(/\s+/)[0];
}

/** How to address this contact in an outbound message. */
export function greetingName(name?: string | null): string {
  return isPlaceholderLeadName(name) ? 'there' : (name ?? '').trim();
}

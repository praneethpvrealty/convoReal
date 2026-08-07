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

/** Whether this name is a placeholder rather than a person. Blank counts:
 *  callers use this to decide what to greet, and "Hi ," is no better. */
export function isPlaceholderLeadName(name?: string | null): boolean {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  return /^(?:portal|housing|99acres|magic\s*bricks|others)\s+lead$/i.test(trimmed);
}

/** How to address this contact in an outbound message. */
export function greetingName(name?: string | null): string {
  return isPlaceholderLeadName(name) ? 'there' : (name ?? '').trim();
}

// ============================================================
// Which handler owns an inbound lead message.
//
// The qualification ladder is the default, and it used to be the only
// thing that read a lead's free text — so every message it could not
// use was still answered with the next rung. Three kinds of message
// have since been carved out of it, each because a real lead was
// answered with "what kind of property are you looking for?" when they
// had asked for something else entirely: a callback, a listing by
// number, and the photos of a listing.
//
// Those carve-outs lived only inside processBuyerQualificationMessage,
// which the dev simulator does not call — so the simulator kept showing
// an agent the ladder question for messages production no longer sends
// it for. Naming the decision once, here, is what stops the two
// drifting again (AGENTS.md §2.8: put the logic where both can reach
// it).
//
// Pure and free: every predicate it composes is a regex over the
// lead's own words. It decides who answers, which is too cheap to pay
// an intent call for.
// ============================================================

import { requestsHumanContact } from '@/lib/ai/lead-question';
import { requestsPropertyPhotos } from '@/lib/ai/photo-request';
import { parseOrdinalReferences } from '@/lib/ai/shortlist-reference';
import { carriesRequirementSignal } from '@/lib/ai/requirement-signal';
import { isDirectPropertyInterest } from '@/lib/whatsapp/property-interest';
import { isPropertyDisinterest } from '@/lib/whatsapp/property-disinterest';

export type LeadRoute =
  | 'callback_handover'
  | 'property_enquiry'
  | 'property_interest'
  | 'property_disinterest'
  | 'photo_request'
  | 'shortlist_reference'
  | 'qualification';

/**
 * The showcase's Enquire button always stamps its message with
 * "(Property ID: <code>)" — nothing else writes that phrase into a
 * buyer's message. Matched here as the phrase rather than any one
 * account's code format, because this module is pure text and codes
 * are per-account.
 */
const EXPLICIT_ENQUIRY = /\bproperty\s*id\b\s*[:#]?/i;

export function isExplicitPropertyEnquiry(text?: string | null): boolean {
  return EXPLICIT_ENQUIRY.test((text || '').trim());
}

/**
 * The handler that claims this message.
 *
 * Order is the order the carve-outs are decided in, and only the first
 * two placements carry weight:
 *
 * - A callback wins outright. "Call me and send the photos" asks for a
 *   person, and a person answering brings the photos with them; photos
 *   alone would drop the callback on the floor.
 * - Photos beat a bare listing number, because "send photos of option
 *   2" is a photo request that happens to name its subject — the
 *   subject resolver reads the ordinal separately, so nothing is lost
 *   by routing it to the photos.
 *
 * A message carrying an actual requirement stays with the ladder even
 * when it also asks for photos ("looking for a villa in Whitefield,
 * send photos"): the requirement is the part only the ladder can file,
 * and the photos follow from the shortlist it replies with.
 */
export function routeLeadMessage(text?: string | null): LeadRoute {
  const value = (text || '').trim();
  if (!value) return 'qualification';

  if (requestsHumanContact(value)) return 'callback_handover';

  // Before the requirement check on purpose: an enquiry names the exact
  // listing, and the listing's own title puts a property-type word in
  // the message ("Commercial Land in 6th Block…") — so the requirement
  // signal is true by construction. Reading it as a requirement is what
  // answered a buyer who tapped Enquire with "what budget range are you
  // working with?" instead of an acknowledgement and an approval card.
  if (isExplicitPropertyEnquiry(value)) return 'property_enquiry';
  if (isDirectPropertyInterest(value)) return 'property_interest';

  const hasRequirement = carriesRequirementSignal(value);
  if (isPropertyDisinterest(value) && !hasRequirement)
    return 'property_disinterest';
  if (requestsPropertyPhotos(value) && !hasRequirement) return 'photo_request';
  if (parseOrdinalReferences(value).length > 0 && !hasRequirement) {
    return 'shortlist_reference';
  }

  return 'qualification';
}

/** True when the ladder must stand down and let another handler reply. */
export function standsDownFromQualification(text?: string | null): boolean {
  return routeLeadMessage(text) !== 'qualification';
}

export function isBuyerRequirementMessage(text?: string | null): boolean {
  return (
    routeLeadMessage(text) === 'qualification' && carriesRequirementSignal(text)
  );
}

/** What each route does, for the dev simulator's routing panel. */
export const LEAD_ROUTE_EXPLANATIONS: Record<LeadRoute, string> = {
  callback_handover:
    'Asks for a person. The bot promises a callback and notifies the assigned agent — the ladder never sees it.',
  property_enquiry:
    'Names a listing by its property code — the showcase Enquire button. The buyer gets an acknowledgement and the agent gets the Approve/Reject card; approving sends the complete details.',
  property_interest:
    'Refers to a specific listing the buyer saw. The bot resolves the locality and size, shares that listing immediately, asks for property-specific questions, and hands the conversation to the assigned agent.',
  property_disinterest:
    'Rejects a listing or option ("not interested"). The bot records the rejection on listing_feedback and asks for specific factors (type, budget, location, size) via interactive one-tap options or typed feedback.',
  photo_request:
    "Asks for a listing's photos. The bot sends the photos of whichever listing the thread is pinned to, then a link to the full gallery.",
  shortlist_reference:
    "Names a listing by its shortlist number. The bot answers that listing's question from its own fields, then Gemini grounded in them.",
  qualification:
    'Carries requirement detail, so the qualification ladder files it and replies with the next missing answer or the matching listings.',
};

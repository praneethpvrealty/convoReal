/**
 * When the public showcase asks an anonymous visitor for a WhatsApp
 * number, and what it tells the agent about the moment they gave it.
 *
 * Two in three showcase sessions never identify themselves, and the
 * only way an anonymous visitor ever turned into a lead was the form at
 * the very bottom of the listing panel. These rules pick the two moments
 * where the ask is cheapest for the visitor and worth most to the agent:
 * a second listing opened in one visit, and a high fit rating.
 */

export const CAPTURE_AFTER_DISTINCT_VIEWS = 2;
export const VISITOR_CAPTURE_DISMISSED_KEY = 'visitor_capture_dismissed';

export type VisitorInquiryIntent =
  'quick_interest' | 'high_rating' | 'browsing_capture';

export function shouldOfferBrowsingCapture(args: {
  distinctViews: number;
  identified: boolean;
  dismissed: boolean;
  agentMode: boolean;
}): boolean {
  if (args.agentMode || args.identified || args.dismissed) return false;
  return args.distinctViews >= CAPTURE_AFTER_DISTINCT_VIEWS;
}

export function visitorInquiryMessage(
  intent: VisitorInquiryIntent,
  rating?: number | null
): string {
  switch (intent) {
    case 'quick_interest':
      return "Tapped “I'm interested” on the showcase — wants a call back about this property.";
    case 'high_rating':
      return `Visitor rated this property ${rating ?? ''}/10 — high interest.`;
    case 'browsing_capture':
      return 'Shared their WhatsApp number while browsing the showcase — wants exact locations and updates.';
  }
}

export function hasVisitorIdentity(name: string, phone: string): boolean {
  return name.trim().length > 0 && phone.replace(/\D/g, '').length >= 10;
}

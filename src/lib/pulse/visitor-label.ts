import type { HydratedShowcaseEvent } from './queries';

/**
 * Who a feed row belongs to. An identified visitor is named; a guest who
 * arrived on a contact's forwarded link is labelled as coming via that
 * contact, never as the contact; a guest from a generic share is dated
 * to the share; everyone else is an anonymous guest.
 */
export function pulseVisitorLabel(
  event: Pick<
    HydratedShowcaseEvent,
    'contact' | 'via_contact' | 'share' | 'session_key'
  >,
  timeAgo: (iso: string) => string
): string {
  if (event.contact) {
    return event.contact.name || event.contact.phone || 'Contact';
  }
  const tail = event.session_key.slice(0, 8);
  if (event.via_contact) {
    const sender =
      event.via_contact.name || event.via_contact.phone || 'a contact';
    return `Guest via ${sender}'s link · ${tail}`;
  }
  if (event.share) {
    return `Guest via link shared ${timeAgo(event.share.created_at)} · ${tail}`;
  }
  return `Anonymous Guest · ${tail}`;
}

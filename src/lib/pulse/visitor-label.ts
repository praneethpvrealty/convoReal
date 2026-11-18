import type { HydratedShowcaseEvent } from './queries';

type LabelEvent = Pick<
  HydratedShowcaseEvent,
  'contact' | 'via_contact' | 'share' | 'session_key'
>;

export interface PulseVisitorLabelParts {
  before: string;
  contact: { id: string; label: string } | null;
  after: string;
}

/**
 * Who a feed row belongs to. An identified visitor is named; a guest who
 * arrived on a contact's forwarded link is labelled as coming via that
 * contact, never as the contact; a guest from a generic share is dated
 * to the share; everyone else is an anonymous guest. The named contact
 * is returned apart so the feed can render it as a link to that contact.
 */
export function pulseVisitorLabelParts(
  event: LabelEvent,
  timeAgo: (iso: string) => string
): PulseVisitorLabelParts {
  if (event.contact) {
    return {
      before: '',
      contact: {
        id: event.contact.id,
        label: event.contact.name || event.contact.phone || 'Contact',
      },
      after: '',
    };
  }
  const tail = event.session_key.slice(0, 8);
  if (event.via_contact) {
    return {
      before: 'Guest via ',
      contact: {
        id: event.via_contact.id,
        label: event.via_contact.name || event.via_contact.phone || 'a contact',
      },
      after: `'s link · ${tail}`,
    };
  }
  if (event.share) {
    return {
      before: `Guest via link shared ${timeAgo(event.share.created_at)} · ${tail}`,
      contact: null,
      after: '',
    };
  }
  return { before: `Anonymous Guest · ${tail}`, contact: null, after: '' };
}

export function pulseVisitorLabel(
  event: LabelEvent,
  timeAgo: (iso: string) => string
): string {
  const parts = pulseVisitorLabelParts(event, timeAgo);
  return `${parts.before}${parts.contact?.label ?? ''}${parts.after}`;
}

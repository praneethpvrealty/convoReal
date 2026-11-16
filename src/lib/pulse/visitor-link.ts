import type { HydratedShowcaseEvent } from './queries';

export function contactDetailsHref(contactId: string): string {
  return `/contacts?contactId=${encodeURIComponent(contactId)}`;
}

export function visitorContactHref(
  event: Pick<HydratedShowcaseEvent, 'contact'>
): string | null {
  return event.contact ? contactDetailsHref(event.contact.id) : null;
}

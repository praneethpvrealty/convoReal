import type { HydratedShowcaseEvent } from './queries';

export function visitorContactHref(
  event: Pick<HydratedShowcaseEvent, 'contact'>
): string | null {
  return event.contact
    ? `/contacts?contactId=${encodeURIComponent(event.contact.id)}`
    : null;
}

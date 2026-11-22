import type { HydratedShowcaseEvent } from './queries';

export function contactDetailsHref(contactId: string): string {
  return `/contacts?contactId=${encodeURIComponent(contactId)}`;
}

export function visitorContactHref(
  event: Pick<HydratedShowcaseEvent, 'contact'>
): string | null {
  return event.contact ? contactDetailsHref(event.contact.id) : null;
}

export function propertyDetailsHref(propertyId: string): string {
  return `/inventory?propertyId=${encodeURIComponent(propertyId)}`;
}

export function activityPropertyHref(
  event: Pick<HydratedShowcaseEvent, 'event_type'> & {
    property?: { id: string } | null;
  }
): string | null {
  if (event.event_type === 'open' || event.event_type === 'search') return null;
  return event.property ? propertyDetailsHref(event.property.id) : null;
}

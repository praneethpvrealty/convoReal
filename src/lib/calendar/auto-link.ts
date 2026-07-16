// ============================================================
// Bidirectional contact ↔ property auto-linking for events and
// tasks, keyed off contacts.last_inquired_property_id. One rule,
// used by every entry surface — the AI parse endpoint, the
// WhatsApp owner-scheduling flow, the calendar @/# mentions, and
// the appointment dialogs — so a half-specified event lands fully
// tagged the same way no matter where it was created.
//
// Pure functions only: safe to import from client components.
// ============================================================

export interface LinkableContact {
  id: string;
  last_inquired_property_id?: string | null;
}

/**
 * Fill whichever side is missing: a resolved contact pulls in the
 * property they inquired about, and a resolved property pulls in
 * the contact linked to it. Never overrides a side that is set.
 */
export function autoLinkContactProperty<C extends LinkableContact, P extends { id: string }>(
  contact: C | null,
  property: P | null,
  contacts: C[],
  properties: P[],
): { contact: C | null; property: P | null } {
  if (contact && !property && contact.last_inquired_property_id) {
    const linkedPropertyId = contact.last_inquired_property_id;
    property = properties.find((p) => p.id === linkedPropertyId) || null;
  }
  if (property && !contact) {
    const linkedPropertyId = property.id;
    contact = contacts.find((c) => c.last_inquired_property_id === linkedPropertyId) || null;
  }
  return { contact, property };
}

/** Multi-contact pickers: the first selected contact whose inquiry
 *  maps to a property we actually know about, with that property. */
export function linkedPropertyForContacts<C extends LinkableContact, P extends { id: string }>(
  selectedIds: string[],
  contacts: C[],
  properties: P[],
): { contact: C; property: P } | null {
  for (const id of selectedIds) {
    const contact = contacts.find((c) => c.id === id);
    if (!contact?.last_inquired_property_id) continue;
    const property = properties.find((p) => p.id === contact.last_inquired_property_id);
    if (property) return { contact, property };
  }
  return null;
}

/** Property pickers: the contact who inquired about this property. */
export function linkedContactForProperty<C extends LinkableContact>(
  propertyId: string,
  contacts: C[],
): C | null {
  return contacts.find((c) => c.last_inquired_property_id === propertyId) || null;
}

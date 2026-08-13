/**
 * The map pin that arrives before the listing it belongs to.
 *
 * A pin on its own is neither a listing nor a contact, so the intake
 * classifier returned 'none' and the assistant answered "I couldn't
 * tell what that was" — and threw the pin away. Agents send the pin
 * first and the details second all the time, so the listing that
 * followed seconds later was saved with no coordinates at all, despite
 * the lister having sent the most precise thing they had.
 *
 * The pin is parked here instead (pending_map_pins, migration 261) and
 * attached to the next listing draft that sender opens. It only ever
 * fills gaps: a listing that carries its own map link or coordinates
 * keeps them.
 *
 * Deliberately short-lived. A pin is a weaker signal than a draft, and
 * stamping a stale one onto an unrelated listing puts the property in
 * the wrong place — worse than leaving it unpinned. Anything older than
 * PENDING_PIN_TTL_MS is ignored and swept.
 */

import type { ParsedPropertyDraft } from '@/lib/ai/gemini';
import { resolveLocationFromGoogleMapLink } from '@/lib/maps/resolve-location';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const PENDING_PIN_TTL_MS = 15 * 60 * 1000;

export interface PendingMapPin {
  mapLink: string;
  location: string | null;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Holds a shared pin against the sender, resolving what it points at so
 * the acknowledgement can name the place. Never throws — a failed
 * geocode still parks the link itself, which is the part the listing
 * needs.
 */
export async function parkMapPin(input: {
  accountId: string;
  contactId: string;
  conversationId: string;
  mapLink: string;
}): Promise<PendingMapPin> {
  const derived = await resolveLocationFromGoogleMapLink(input.mapLink);
  const pin: PendingMapPin = {
    mapLink: input.mapLink,
    location: derived?.location ?? null,
    sublocality: derived?.sublocality ?? null,
    city: derived?.city ?? null,
    state: derived?.state ?? null,
    latitude: derived?.latitude ?? null,
    longitude: derived?.longitude ?? null,
  };

  try {
    await supabaseAdmin().from('pending_map_pins').upsert(
      {
        account_id: input.accountId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        map_link: pin.mapLink,
        location: pin.location,
        sublocality: pin.sublocality,
        city: pin.city,
        state: pin.state,
        latitude: pin.latitude,
        longitude: pin.longitude,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contact_id' }
    );
  } catch (err) {
    console.error('[maps] parkMapPin failed:', err);
  }

  return pin;
}

/**
 * Claims the sender's parked pin, if one is still fresh. Consumed on
 * read — a pin belongs to one listing, and a second listing in the same
 * quarter-hour is a different property.
 */
export async function takePendingMapPin(
  accountId: string,
  contactId: string
): Promise<PendingMapPin | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('pending_map_pins')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (!data) return null;
    await supabaseAdmin().from('pending_map_pins').delete().eq('id', data.id);

    const parkedAt = new Date(data.updated_at).getTime();
    if (Date.now() - parkedAt > PENDING_PIN_TTL_MS) return null;

    return {
      mapLink: data.map_link,
      location: data.location ?? null,
      sublocality: data.sublocality ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
  } catch (err) {
    console.error('[maps] takePendingMapPin failed:', err);
    return null;
  }
}

/**
 * Attaches a parked pin to a freshly parsed draft. The listing's own
 * words win everywhere they exist — the pin supplies the coordinates
 * and fills the parts the lister didn't type.
 */
export function applyPinToDraft(
  draft: ParsedPropertyDraft,
  pin: PendingMapPin
): ParsedPropertyDraft {
  if (draft.google_map_link || draft.latitude != null) return draft;

  return {
    ...draft,
    google_map_link: pin.mapLink,
    latitude: pin.latitude,
    longitude: pin.longitude,
    location: draft.location || pin.location,
    sublocality: draft.sublocality || pin.sublocality,
    city: draft.city || pin.city,
    state: draft.state || pin.state,
    geo_resolved_from:
      pin.latitude != null ? pin.mapLink : draft.geo_resolved_from,
  };
}

/** The reply that replaces the "I couldn't tell what that was" nudge. */
export function buildPinParkedMessage(pin: PendingMapPin): string {
  const lines = ['📍 *Location pin saved.*', ''];
  if (pin.location) {
    lines.push(`_${pin.location}_`, '');
  }
  lines.push(
    "Send the property details next and I'll attach this pin to that listing."
  );
  return lines.join('\n');
}

/**
 * The templates the Engine sends on its own — as opposed to the ones an
 * account writes by hand in Settings. Each one has a builder that
 * produces a Meta-ready payload, so a missing template can be created
 * and submitted with a single tap instead of being retyped.
 *
 * Kept in one place because these were previously reachable only from
 * whichever screen happened to need them: the property-details template
 * could only be submitted from a panel in Radar that appears when a send
 * has already failed, which is a bad time to discover it is missing.
 */

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { buildPropertyAlertTemplatePayload, PROPERTY_ALERT_TEMPLATE_NAME } from './property-alert-template';
import { buildLocationRevealTemplatePayload, LOCATION_REVEAL_TEMPLATE_NAME } from './location-reveal-template';
import { buildInventoryUpdateTemplatePayload, INVENTORY_UPDATE_TEMPLATE_NAME } from './inventory-update-template';

export interface EngineTemplateDef {
  name: string;
  label: string;
  /** What breaks while this template is missing. */
  whyItMatters: string;
  build: (origin: string) => TemplatePayload;
}

export const ENGINE_TEMPLATES: EngineTemplateDef[] = [
  {
    name: PROPERTY_ALERT_TEMPLATE_NAME,
    label: 'Property details',
    whyItMatters:
      'Sends a listing to a buyer who is outside the 24-hour window — Match Radar alerts, share-property and the buyer digest all fall back to it.',
    build: buildPropertyAlertTemplatePayload,
  },
  {
    name: LOCATION_REVEAL_TEMPLATE_NAME,
    label: 'Location reveal',
    whyItMatters:
      'Delivers an approved exact-location request to a seeker who asked from the public showcase.',
    build: buildLocationRevealTemplatePayload,
  },
  {
    name: INVENTORY_UPDATE_TEMPLATE_NAME,
    label: 'Inventory update',
    whyItMatters: 'Carries an inventory update to a contact with no open service window.',
    build: buildInventoryUpdateTemplatePayload,
  },
];

/**
 * Engine templates the account has no row for at all. A template that
 * exists but was rejected or is still pending is deliberately not
 * reported here — it is already visible in the list with its status, and
 * re-submitting it is a different action from creating it.
 *
 * Exported for tests.
 */
export function missingEngineTemplates(
  existingNames: readonly string[],
): EngineTemplateDef[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return ENGINE_TEMPLATES.filter((t) => !have.has(t.name.toLowerCase()));
}

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
import { buildPropertyEnquiryPhotosTemplatePayload, PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME } from './property-enquiry-photos-template';
import { buildLocationRevealTemplatePayload, LOCATION_REVEAL_TEMPLATE_NAME } from './location-reveal-template';
import { buildInventoryUpdateTemplatePayload, INVENTORY_UPDATE_TEMPLATE_NAME } from './inventory-update-template';
import { buildEnquiryFollowupTemplatePayload, ENQUIRY_FOLLOWUP_TEMPLATE_NAME } from './enquiry-followup-template';
import { buildBuyerAlertsConsentTemplatePayload, BUYER_ALERTS_CONSENT_TEMPLATE_NAME } from './buyer-alerts-consent-template';

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
    name: PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME,
    label: 'Property photos',
    whyItMatters:
      'Photo-first property share to a buyer outside the 24-hour window — the Utility replacement for Marketing image templates that error 131049 silently drops.',
    build: buildPropertyEnquiryPhotosTemplatePayload,
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
  {
    name: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
    label: 'Enquiry status',
    whyItMatters:
      'Re-engages imported portal leads whose original listing expired — a status notice asking for their latest requirement, with buttons to update preferences or close the enquiry.',
    build: buildEnquiryFollowupTemplatePayload,
  },
  {
    name: BUYER_ALERTS_CONSENT_TEMPLATE_NAME,
    label: 'Buyer alerts consent',
    whyItMatters:
      'Asks a buyer with no open window whether they want match alerts — without it the buyer match digest can only ask buyers who happen to be mid-chat, so most are never asked and never opt in.',
    build: buildBuyerAlertsConsentTemplatePayload,
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

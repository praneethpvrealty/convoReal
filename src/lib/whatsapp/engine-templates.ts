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
import type { LanguageCode } from '@/lib/languages';
import type { EngineTemplateKey } from '@/lib/whatsapp/template-copy';
import {
  buildPropertyAlertTemplatePayload,
  PROPERTY_ALERT_TEMPLATE_NAME,
} from './property-alert-template';
import {
  buildPropertyEnquiryPhotosTemplatePayload,
  PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME,
} from './property-enquiry-photos-template';
import {
  buildLocationRevealTemplatePayload,
  LOCATION_REVEAL_TEMPLATE_NAME,
} from './location-reveal-template';
import {
  buildInventoryUpdateTemplatePayload,
  INVENTORY_UPDATE_TEMPLATE_NAME,
} from './inventory-update-template';
import {
  buildEnquiryFollowupTemplatePayload,
  ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
} from './enquiry-followup-template';
import {
  buildEnquiryNoticeTemplatePayload,
  ENQUIRY_NOTICE_TEMPLATE_NAME,
} from './enquiry-notice-template';
import {
  buildJourneyCheckinTemplatePayload,
  JOURNEY_CHECKIN_TEMPLATE_NAME,
} from './journey-checkin-template';
import {
  buildTimelineAskTemplatePayload,
  buildFollowupReminderTemplatePayload,
  TIMELINE_ASK_TEMPLATE_NAME,
  FOLLOWUP_REMINDER_TEMPLATE_NAME,
} from './timeline-ask-template';
import {
  buildAnnouncementTemplatePayload,
  ANNOUNCEMENT_TEMPLATE_NAME,
} from './announcement-template';

export interface EngineTemplateDef {
  name: string;
  label: string;
  /** What breaks while this template is missing. */
  whyItMatters: string;
  /** The copy key this template's translations live under. */
  copyKey: EngineTemplateKey;
  /**
   * Meta keys a template on (name, language) and treats each pair as
   * its own registration, so one definition builds every variant —
   * the language decides the body, footer and button wording.
   */
  build: (origin: string, language: LanguageCode) => TemplatePayload;
}

export const ENGINE_TEMPLATES: EngineTemplateDef[] = [
  {
    name: PROPERTY_ALERT_TEMPLATE_NAME,
    copyKey: 'property_alert',
    label: 'Property details',
    whyItMatters:
      'Sends a listing to a buyer who is outside the 24-hour window — Match Radar alerts, share-property and the buyer digest all fall back to it.',
    build: buildPropertyAlertTemplatePayload,
  },
  {
    name: PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME,
    copyKey: 'property_enquiry_photos',
    label: 'Property photos',
    whyItMatters:
      'Photo-first property share to a buyer outside the 24-hour window — the Utility replacement for Marketing image templates that error 131049 silently drops.',
    build: buildPropertyEnquiryPhotosTemplatePayload,
  },
  {
    name: LOCATION_REVEAL_TEMPLATE_NAME,
    copyKey: 'location_reveal',
    label: 'Location reveal',
    whyItMatters:
      'Delivers an approved exact-location request to a seeker who asked from the public showcase.',
    build: buildLocationRevealTemplatePayload,
  },
  {
    name: INVENTORY_UPDATE_TEMPLATE_NAME,
    copyKey: 'inventory_update',
    label: 'Inventory update',
    whyItMatters:
      'Carries an inventory update to a contact with no open service window.',
    build: buildInventoryUpdateTemplatePayload,
  },
  {
    name: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
    copyKey: 'enquiry_followup',
    label: 'Enquiry status',
    whyItMatters:
      'Re-engages imported portal leads whose original listing expired — a status notice asking for their latest requirement, with buttons to update preferences or close the enquiry.',
    build: (_origin, language) => buildEnquiryFollowupTemplatePayload(language),
  },
  {
    name: ENQUIRY_NOTICE_TEMPLATE_NAME,
    copyKey: 'enquiry_notice',
    label: 'Enquiry notice',
    whyItMatters:
      'The property-anchored version of the enquiry status notice — names the listing the lead enquired about, so the message is specific rather than a form letter. Used for leads whose enquired property is known.',
    build: (_origin, language) => buildEnquiryNoticeTemplatePayload(language),
  },
  {
    name: JOURNEY_CHECKIN_TEMPLATE_NAME,
    copyKey: 'journey_checkin',
    label: 'Enquiry check-in',
    whyItMatters:
      'Asks a buyer whether a journey listing is still under consideration when their 24-hour window has closed — the template form of the check-in the Journey sheet drafts.',
    build: buildJourneyCheckinTemplatePayload,
  },
  {
    name: TIMELINE_ASK_TEMPLATE_NAME,
    copyKey: 'journey_timeline',
    label: 'Enquiry timeline',
    whyItMatters:
      'Asks a lead who said they would come back with a decision to pick when we should check back, when their 24-hour window has closed — the answer sets the journey plan and files the follow-up to-do automatically. Came back MARKETING; superseded by Enquiry follow-up reminder, which is preferred at send time once approved.',
    build: buildTimelineAskTemplatePayload,
  },
  {
    name: FOLLOWUP_REMINDER_TEMPLATE_NAME,
    copyKey: 'journey_followup_reminder',
    label: 'Enquiry follow-up reminder',
    whyItMatters:
      "The Utility-shaped replacement for Enquiry timeline: states the follow-up date already set on the lead's open enquiry and lets them confirm or move it, the same shape the four approved reminder templates use. Preferred over the Marketing row as soon as Meta approves it.",
    build: buildFollowupReminderTemplatePayload,
  },
  {
    name: ANNOUNCEMENT_TEMPLATE_NAME,
    copyKey: 'audio_announcement',
    label: 'Audio announcement',
    whyItMatters:
      "Carries an audio announcement (as a playable video) to contacts outside the 24-hour window — without it, announcements only reach contacts who messaged recently. Marketing category by nature; sends stay opt-in via each contact's update-channel preference.",
    build: buildAnnouncementTemplatePayload,
  },
];

/**
 * The copy key behind a template NAME, or null when the name is not
 * one of ours.
 *
 * A stored row knows its name and language but not which entry of
 * TEMPLATE_COPY it came from, and every drift comparison needs that.
 * Null for an account-authored template, which has no shipped copy to
 * drift from.
 */
export function engineCopyKey(name: string): EngineTemplateKey | null {
  const match = ENGINE_TEMPLATES.find(
    (t) => t.name.toLowerCase() === name.trim().toLowerCase()
  );
  return match?.copyKey ?? null;
}

/** Fast membership test for "is this one of ours?" — used by the
 *  translation-review gate, which must not require a review for a
 *  template the account wrote itself. */
export const ENGINE_TEMPLATE_NAMES: ReadonlySet<string> = new Set(
  ENGINE_TEMPLATES.map((t) => t.name)
);

/**
 * Engine templates the account has no row for at all. A template that
 * exists but was rejected or is still pending is deliberately not
 * reported here — it is already visible in the list with its status, and
 * re-submitting it is a different action from creating it.
 *
 * Exported for tests.
 */
export function missingEngineTemplates(
  existingNames: readonly string[]
): EngineTemplateDef[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return ENGINE_TEMPLATES.filter((t) => !have.has(t.name.toLowerCase()));
}

import { describe, expect, it } from 'vitest';
import { ENGINE_TEMPLATES, missingEngineTemplates } from './engine-templates';
import { validateTemplatePayload } from './template-validators';
import { LANGUAGE_CODES, metaLanguageCode } from '@/lib/languages';

describe('missingEngineTemplates', () => {
  it('reports a template the account has no row for', () => {
    const missing = missingEngineTemplates([
      'location_reveal',
      'inventory_update',
      'enquiry_status_notice',
    ]);
    expect(missing.map((t) => t.name)).toEqual([
      'listing_details_notice',
      'listing_photos_notice',
      'listing_status_notice',
      'enquiry_checkin_notice',
      'enquiry_timeline_notice',
      'property_enquiry_reminder',
      'audio_announcement_notice',
      'post_call_options',
    ]);
  });

  it('offers the branded photo template to an account still on the old one', () => {
    // Same rename, same reason: property_enquiry_photos is approved and
    // sending, its URL button just carries the dashboard host.
    expect(
      missingEngineTemplates(['property_enquiry_gallery']).map((t) => t.name),
    ).toContain('listing_photos_notice');
  });

  it('offers the branded property-details template to an account still on the old one', () => {
    // property_enquiry_response is approved and sending; its URL button
    // just carries the dashboard host. Meta fixes a category at review
    // and an edit is a fresh review, so the branded version ships under
    // a new name — which means this list has to keep offering it even
    // though the account already has a working predecessor.
    expect(
      missingEngineTemplates(['property_enquiry_info']).map((t) => t.name),
    ).toContain('listing_details_notice');
  });

  it('ignores case and stray whitespace on existing names', () => {
    expect(missingEngineTemplates(['  Property_Enquiry_Info '])).not.toContainEqual(
      expect.objectContaining({ name: 'property_enquiry_info' }),
    );
  });

  it('reports nothing once every engine template exists', () => {
    expect(missingEngineTemplates(ENGINE_TEMPLATES.map((t) => t.name))).toEqual([]);
  });

  it('reports all of them for a fresh account', () => {
    expect(missingEngineTemplates([])).toHaveLength(ENGINE_TEMPLATES.length);
  });

  // Every (template, language) pair is its own Meta registration, so
  // every pair has to survive validation — a translation that busts a
  // length cap or drops a placeholder is only discoverable here or in
  // a rejection from Meta that reserves the name for four weeks.
  it('every builder produces a payload the submit API accepts, in every language', () => {
    for (const t of ENGINE_TEMPLATES) {
      for (const language of LANGUAGE_CODES) {
        expect(
          () =>
            validateTemplatePayload(
              t.build('https://www.convoreal.com', language),
            ),
          `${t.name} / ${language}`,
        ).not.toThrow();
      }
    }
  });

  it('registers each language under the Meta code for it', () => {
    for (const t of ENGINE_TEMPLATES) {
      for (const language of LANGUAGE_CODES) {
        expect(t.build('https://www.convoreal.com', language).language).toBe(
          metaLanguageCode(language),
        );
      }
    }
  });

  // The name is the identity Meta keys on alongside the language;
  // varying it per language would create seven unrelated templates
  // instead of seven variants of one, and the send-time resolver
  // would never find them.
  it('keeps one name across every language', () => {
    for (const t of ENGINE_TEMPLATES) {
      for (const language of LANGUAGE_CODES) {
        expect(t.build('https://www.convoreal.com', language).name).toBe(t.name);
      }
    }
  });

  it('translates the body away from English for every non-English variant', () => {
    for (const t of ENGINE_TEMPLATES) {
      const english = t.build('https://www.convoreal.com', 'en').body_text;
      for (const language of LANGUAGE_CODES) {
        if (language === 'en') continue;
        expect(
          t.build('https://www.convoreal.com', language).body_text,
          `${t.name} / ${language}`,
        ).not.toBe(english);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ENGINE_TEMPLATES, missingEngineTemplates } from './engine-templates';
import { validateTemplatePayload } from './template-validators';

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

  it('every builder produces a payload the submit API accepts', () => {
    for (const t of ENGINE_TEMPLATES) {
      expect(() => validateTemplatePayload(t.build('https://www.convoreal.com'))).not.toThrow();
    }
  });
});

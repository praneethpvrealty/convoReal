import { describe, expect, it } from 'vitest';
import { ENGINE_TEMPLATES, missingEngineTemplates } from './engine-templates';
import { validateTemplatePayload } from './template-validators';

describe('missingEngineTemplates', () => {
  it('reports a template the account has no row for', () => {
    const missing = missingEngineTemplates(['location_reveal', 'inventory_update']);
    expect(missing.map((t) => t.name)).toEqual(['property_enquiry_response']);
  });

  it('ignores case and stray whitespace on existing names', () => {
    expect(missingEngineTemplates(['  Property_Enquiry_Response '])).not.toContainEqual(
      expect.objectContaining({ name: 'property_enquiry_response' }),
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

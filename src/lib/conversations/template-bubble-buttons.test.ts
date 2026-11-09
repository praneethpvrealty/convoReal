import { describe, expect, it } from 'vitest';

import {
  matchTemplateRow,
  templateBubbleButtons,
  templateNamesIn,
} from './template-bubble-buttons';

const english = {
  name: 'property_portal_invite',
  language: 'en_US',
  status: 'APPROVED',
  body_text: 'Hi {{1}} 👋, this is {{2}}.',
  buttons: [{ type: 'URL', text: 'Open the portal' }],
};
const hindi = {
  name: 'property_portal_invite',
  language: 'hi',
  status: 'APPROVED',
  body_text: 'नमस्ते {{1}} 👋, यह {{2}} की ओर से संदेश है।',
  buttons: [{ type: 'URL', text: 'पोर्टल खोलें' }],
};
const draft = {
  name: 'property_portal_invite',
  language: 'kn',
  status: null,
  body_text: 'ನಮಸ್ಕಾರ {{1}}',
  buttons: [{ type: 'URL', text: 'ಪೋರ್ಟಲ್ ತೆರೆಯಿರಿ' }],
};

describe('templateNamesIn', () => {
  it('[CTM-002] lists each sent template once', () => {
    expect(
      templateNamesIn([
        { template_name: 'property_portal_invite' },
        { template_name: null },
        { template_name: 'property_selection_update' },
        { template_name: 'property_portal_invite' },
        {},
      ])
    ).toEqual(['property_portal_invite', 'property_selection_update']);
  });
});

describe('matchTemplateRow', () => {
  it('[CTM-002] picks the language variant the stored body was rendered from', () => {
    expect(
      matchTemplateRow([english, hindi, draft], {
        template_name: 'property_portal_invite',
        content_text: 'नमस्ते Pramod 👋, यह Lakshmi की ओर से संदेश है।',
      })
    ).toBe(hindi);
    expect(
      matchTemplateRow([english, hindi, draft], {
        template_name: 'property_portal_invite',
        content_text: 'Hi Pramod 👋, this is Lakshmi.',
      })
    ).toBe(english);
  });

  it('prefers an approved row when nothing in the body decides', () => {
    expect(
      matchTemplateRow([draft, english], {
        template_name: 'PROPERTY_PORTAL_INVITE',
        content_text: '',
      })
    ).toBe(english);
  });

  it('returns null for a free-text message or an unknown template', () => {
    expect(matchTemplateRow([english], { content_text: 'hello' })).toBeNull();
    expect(
      matchTemplateRow([english], { template_name: 'account_authored' })
    ).toBeNull();
  });
});

describe('templateBubbleButtons', () => {
  it('[CTM-002] labels every button by what a tap does', () => {
    expect(
      templateBubbleButtons({
        name: 'property_selection_update',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Send full list' },
          { type: 'QUICK_REPLY', text: ' Book a site visit ' },
          { type: 'URL', text: 'Browse showcase' },
          { type: 'PHONE_NUMBER', text: 'Call us' },
          { type: 'COPY_CODE', text: 'Copy code' },
          { type: 'URL', text: '' },
        ],
      })
    ).toEqual([
      { kind: 'reply', label: 'Send full list' },
      { kind: 'reply', label: 'Book a site visit' },
      { kind: 'url', label: 'Browse showcase' },
      { kind: 'call', label: 'Call us' },
      { kind: 'copy', label: 'Copy code' },
    ]);
    expect(templateBubbleButtons(null)).toEqual([]);
  });
});

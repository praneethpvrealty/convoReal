import { describe, expect, it } from 'vitest';

import {
  metaTemplateContent,
  metaTemplatePayloadFields,
  type MetaTemplate,
} from './meta-template-row';

const HELD: MetaTemplate = {
  id: '1063333170014622',
  name: 'post_call_options',
  language: 'kn',
  status: 'APPROVED',
  category: 'MARKETING',
  components: [
    {
      type: 'HEADER',
      format: 'TEXT',
      text: 'ಶೀರ್ಷಿಕೆ {{1}}',
      example: { header_text: ['ಪ್ರಣೀತ್'] },
    },
    {
      type: 'BODY',
      text: 'ನಮಸ್ಕಾರ {{1}}, {{2}}',
      example: { body_text: [['ಪ್ರಣೀತ್', 'ಬ್ರೂಕ್‌ಫೀಲ್ಡ್']] },
    },
    { type: 'FOOTER', text: 'ನಿಲ್ಲಿಸಲು STOP' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'ಹೌದು' },
        {
          type: 'URL',
          text: 'ನೋಡಿ',
          url: 'https://example.test/p/{{1}}',
          example: ['abc'],
        },
      ],
    },
  ],
};

describe('metaTemplateContent', () => {
  it('[CLG-005] reads every component as the row stores it', () => {
    expect(metaTemplateContent(HELD)).toEqual({
      header_type: 'text',
      header_content: 'ಶೀರ್ಷಿಕೆ {{1}}',
      header_handle: null,
      body_text: 'ನಮಸ್ಕಾರ {{1}}, {{2}}',
      footer_text: 'ನಿಲ್ಲಿಸಲು STOP',
      buttons: [
        { type: 'QUICK_REPLY', text: 'ಹೌದು' },
        {
          type: 'URL',
          text: 'ನೋಡಿ',
          url: 'https://example.test/p/{{1}}',
          example: 'abc',
        },
      ],
      sample_values: {
        body: ['ಪ್ರಣೀತ್', 'ಬ್ರೂಕ್‌ಫೀಲ್ಡ್'],
        header: ['ಪ್ರಣೀತ್'],
      },
    });
  });

  it('[CLG-005] leaves absent parts null', () => {
    expect(
      metaTemplateContent({
        ...HELD,
        components: [{ type: 'BODY', text: 'ಪದಗಳು' }],
      })
    ).toEqual({
      header_type: null,
      header_content: null,
      header_handle: null,
      body_text: 'ಪದಗಳು',
      footer_text: null,
      buttons: null,
      sample_values: null,
    });
  });
});

describe('metaTemplatePayloadFields', () => {
  it('[CLG-005] maps null to undefined for the submit payload', () => {
    const fields = metaTemplatePayloadFields({
      ...HELD,
      components: [{ type: 'BODY', text: 'ಪದಗಳು' }],
    });
    expect(fields.body_text).toBe('ಪದಗಳು');
    expect(fields.footer_text).toBeUndefined();
    expect(fields.buttons).toBeUndefined();
    expect(fields.header_type).toBeUndefined();
    expect(fields.sample_values).toBeUndefined();
  });
});

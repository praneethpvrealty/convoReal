import { describe, expect, it } from 'vitest';

import { validateTemplatePayload } from './template-validators';
import {
  OCCASION_GREETING_TEMPLATE_NAME,
  buildOccasionGreetingTemplatePayload,
  buildOccasionGreetingVariables,
} from './occasion-greeting-template';

describe('buildOccasionGreetingTemplatePayload', () => {
  const payload = buildOccasionGreetingTemplatePayload(
    'https://app.example.com/'
  );

  it('passes template validation with three body variables', () => {
    expect(validateTemplatePayload(payload)).toEqual({
      bodyVarCount: 3,
      headerVarCount: 0,
    });
  });

  it('is a Marketing image-header template under the shared name', () => {
    expect(payload.name).toBe(OCCASION_GREETING_TEMPLATE_NAME);
    expect(payload.category).toBe('Marketing');
    expect(payload.header_type).toBe('image');
    expect(payload.header_media_url).toBe(
      'https://app.example.com/brand/app-icon-1024.png'
    );
  });

  it('keeps the opt-out instruction on the STOP ALERTS command', () => {
    expect(payload.footer_text).toContain('STOP ALERTS');
  });
});

describe('buildOccasionGreetingVariables', () => {
  it('maps the contact name per recipient and the rest statically', () => {
    expect(
      buildOccasionGreetingVariables(
        'Happy Diwali to your family!',
        'Skyline Realty'
      )
    ).toEqual({
      '1': { type: 'field', value: 'name' },
      '2': { type: 'static', value: 'Happy Diwali to your family!' },
      '3': { type: 'static', value: 'Skyline Realty' },
    });
  });

  it('flattens whitespace so Meta never sees a newline in a param', () => {
    const variables = buildOccasionGreetingVariables(
      'Happy\nDiwali!\n\nShine  bright.',
      '  Skyline\nRealty  '
    );
    expect(variables['2']).toEqual({
      type: 'static',
      value: 'Happy Diwali! Shine bright.',
    });
    expect(variables['3']).toEqual({ type: 'static', value: 'Skyline Realty' });
  });
});

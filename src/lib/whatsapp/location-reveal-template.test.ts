import { describe, it, expect } from 'vitest';
import {
  buildLocationRevealTemplatePayload,
  buildLocationRevealParams,
  LOCATION_REVEAL_TEMPLATE_NAME,
} from './location-reveal-template';
import { validateTemplatePayload } from './template-validators';

describe('buildLocationRevealTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com'
    );
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(LOCATION_REVEAL_TEMPLATE_NAME);
  });

  it('is a Utility template — exempt from marketing frequency caps', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com'
    );
    expect(payload.category).toBe('Utility');
  });

  it('carries the reveal token as a URL button suffix', () => {
    const payload = buildLocationRevealTemplatePayload(
      'https://www.convoreal.com/'
    );
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe(
      'https://www.convoreal.com/reveal/{{1}}'
    );
  });
});

describe('buildLocationRevealParams', () => {
  it('uses the first name and property title', () => {
    expect(
      buildLocationRevealParams('Rahul Sharma', 'Villa in Whitefield')
    ).toEqual(['Rahul', 'Villa in Whitefield']);
  });

  it('never produces empty params', () => {
    expect(buildLocationRevealParams(null, '   ')).toEqual([
      'there',
      'the property',
    ]);
    expect(buildLocationRevealParams('  ', '')).toEqual([
      'there',
      'the property',
    ]);
  });
});

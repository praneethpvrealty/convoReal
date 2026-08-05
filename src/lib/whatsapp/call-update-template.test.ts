import { describe, it, expect } from 'vitest';
import {
  buildCallUpdateTemplatePayload,
  buildCallUpdateParams,
  CALL_UPDATE_TEMPLATE_NAME,
} from './call-update-template';
import { validateTemplatePayload } from './template-validators';
import {
  sanitizeParamText,
  truncateParametersToBudget,
} from './template-send-builder';

describe('buildCallUpdateTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildCallUpdateTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(CALL_UPDATE_TEMPLATE_NAME);
  });

  it('is a Utility template — exempt from marketing frequency caps', () => {
    expect(buildCallUpdateTemplatePayload().category).toBe('Utility');
  });

  it('neither starts nor ends with a variable, which Meta rejects', () => {
    const body = buildCallUpdateTemplatePayload().body_text.trim();
    expect(body.startsWith('{{')).toBe(false);
    expect(body.endsWith('}}')).toBe(false);
  });

  it('separates every pair of variables with words, not punctuation', () => {
    // Meta treats two placeholders with only spaces or punctuation
    // between them as consecutive, and rejects the template.
    const body = buildCallUpdateTemplatePayload().body_text;
    expect(/\{\{\d+\}\}[\s,.;:!?_#-]*\{\{\d+\}\}/.test(body)).toBe(false);
  });

  it('samples every variable it declares', () => {
    const payload = buildCallUpdateTemplatePayload();
    const declared = new Set(payload.body_text.match(/\{\{(\d+)\}\}/g) ?? []);
    expect(payload.sample_values?.body).toHaveLength(declared.size);
  });

  it('frames the variable slot with enough fixed text to survive review', () => {
    // A template that is mostly variable gets rejected — the fixed
    // wording has to carry the message's purpose on its own.
    const payload = buildCallUpdateTemplatePayload();
    const staticText = payload.body_text.replace(/\{\{\d+\}\}/g, '').trim();
    expect(staticText.length).toBeGreaterThan(100);
  });
});

describe('buildCallUpdateParams', () => {
  it('uses the first name and passes the update through whole', () => {
    expect(
      buildCallUpdateParams(
        'Chetan Kumar',
        'Aryavart Ventures',
        'Owner is back on the 5th.'
      )
    ).toEqual(['Chetan', 'Aryavart Ventures', 'Owner is back on the 5th.']);
  });

  it('never produces empty params', () => {
    expect(buildCallUpdateParams(null, '  ', '   ')).toEqual([
      'there',
      'your agent',
      'Sharing an update on your enquiry.',
    ]);
  });
});

describe('the update as a template parameter', () => {
  const multiline = [
    'Dear Chetan Kumar,',
    'I just spoke with Prasad, owner side consultant.',
    '',
    'The owner is back by the 5th.',
  ].join('\n');

  it('flattens to a single line — Meta rejects newlines in a parameter', () => {
    const [, , update] = buildCallUpdateParams('Chetan', 'Aryavart', multiline);
    const sent = sanitizeParamText(update);
    expect(sent).not.toMatch(/[\r\n\t]/);
    expect(sent).not.toMatch(/ {4}/);
    // Nothing is dropped in the flattening — only the breaks.
    expect(sent).toContain('Dear Chetan Kumar,');
    expect(sent).toContain('The owner is back by the 5th.');
  });

  it('is the parameter shortened first when the body runs over 1024 chars', () => {
    const payload = buildCallUpdateTemplatePayload();
    const long = 'A very long paragraph about the site visit. '.repeat(40);
    const [name, sender, update] = buildCallUpdateParams(
      'Chetan',
      'Aryavart Ventures',
      long
    );
    const out = truncateParametersToBudget(payload.body_text, [
      name,
      sender,
      update,
    ]);

    // The short params survive intact; the update absorbs the cut.
    expect(out[0]).toBe('Chetan');
    expect(out[1]).toBe('Aryavart Ventures');
    expect(out[2].length).toBeLessThan(sanitizeParamText(long).length);

    const rendered = payload.body_text.replace(
      /\{\{(\d+)\}\}/g,
      (_m, n) => out[Number(n) - 1]
    );
    expect(rendered.length).toBeLessThanOrEqual(1024);
  });
});

import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '@/lib/languages';
import {
  buildNumberChangeParams,
  buildNumberChangeTemplatePayload,
  NUMBER_CHANGE_TEMPLATE_NAME,
  renderNumberChangeNotice,
} from './number-change-template';
import { validateTemplatePayload } from './template-validators';

describe('[WAN-004] contact_number_update template', () => {
  it('is a Utility template with one acknowledgement button in every language', () => {
    for (const language of LANGUAGE_CODES) {
      const payload = buildNumberChangeTemplatePayload(language);
      expect(() => validateTemplatePayload(payload), language).not.toThrow();
      expect(payload.name).toBe(NUMBER_CHANGE_TEMPLATE_NAME);
      expect(payload.category).toBe('Utility');
      expect(payload.buttons).toHaveLength(1);
      expect(payload.buttons?.[0].type).toBe('QUICK_REPLY');
      expect(payload.body_text).toContain('{{1}}');
      expect(payload.body_text).toContain('{{2}}');
      expect(payload.body_text).toContain('{{3}}');
      expect(payload.body_text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it('names the contact, the business and the previous number, with safe fallbacks', () => {
    expect(
      buildNumberChangeParams(
        'Gopi Krishna',
        'Aryavarta Realty',
        '+91 88677 09556'
      )
    ).toEqual(['Gopi', 'Aryavarta Realty', '+91 88677 09556']);
    expect(buildNumberChangeParams('', '  ', '+91 88677 09556')).toEqual([
      'there',
      'our team',
      '+91 88677 09556',
    ]);
    expect(buildNumberChangeParams(null, 'PV', '+91 1')[0]).toBe('there');
  });

  it('renders the same wording free-form for an open conversation', () => {
    const text = renderNumberChangeNotice('en', [
      'Gopi',
      'Aryavarta Realty',
      '+91 88677 09556',
    ]);
    expect(text).toContain(
      'Hi Gopi, this is an account notice from Aryavarta Realty.'
    );
    expect(text).toContain('previous number +91 88677 09556');
    expect(text).not.toContain('{{');
  });
});

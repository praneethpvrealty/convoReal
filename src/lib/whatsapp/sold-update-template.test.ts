import { describe, it, expect } from 'vitest';
import {
  buildSoldUpdateTemplatePayload,
  buildSoldUpdateParams,
  SOLD_UPDATE_TEMPLATE_NAME,
} from './sold-update-template';
import { validateTemplatePayload } from './template-validators';

describe('buildSoldUpdateTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildSoldUpdateTemplatePayload();
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(SOLD_UPDATE_TEMPLATE_NAME);
  });

  it('defines the two quick-reply buttons in handler order', () => {
    const payload = buildSoldUpdateTemplatePayload();
    expect(payload.buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Check sold price' },
      { type: 'QUICK_REPLY', text: 'Find similar' },
    ]);
  });

  it('uses body variables for name and property title', () => {
    const payload = buildSoldUpdateTemplatePayload();
    expect(payload.body_text).toContain('{{1}}');
    expect(payload.body_text).toContain('{{2}}');
    expect(payload.sample_values?.body).toHaveLength(2);
  });
});

describe('buildSoldUpdateParams', () => {
  it('builds name and title params', () => {
    expect(buildSoldUpdateParams('Gopi', '3 BHK Villa in Whitefield')).toEqual([
      'Gopi',
      '3 BHK Villa in Whitefield',
    ]);
  });

  it('falls back to a generic greeting without a name', () => {
    expect(buildSoldUpdateParams(null, 'Plot in Hosur')[0]).toBe('there');
    expect(buildSoldUpdateParams('   ', 'Plot in Hosur')[0]).toBe('there');
  });
});

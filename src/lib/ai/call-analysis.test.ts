import { describe, it, expect } from 'vitest';
import { coerceCallAnalysis } from './call-analysis';

describe('coerceCallAnalysis', () => {
  it('normalizes a well-formed model response', () => {
    const result = coerceCallAnalysis({
      transcript: 'Agent: Hello.\nLawyer: The report is ready.',
      summary: 'The legal report is ready; the sale draft needs one more week.',
      key_points: ['Legal report completed', 'Sale draft pending review'],
      action_items: ['Lawyer to share the sale draft by Friday'],
      update_draft: 'Hi Dr. Ravi, I spoke with the lawyer today...',
    });

    expect(result.transcript).toContain('Lawyer: The report is ready.');
    expect(result.summary).toContain('legal report');
    expect(result.key_points).toHaveLength(2);
    expect(result.action_items).toEqual(['Lawyer to share the sale draft by Friday']);
    expect(result.update_draft).toContain('Dr. Ravi');
  });

  it('returns nulls and empty arrays for garbage input', () => {
    expect(coerceCallAnalysis(null)).toEqual({
      transcript: null,
      summary: null,
      key_points: [],
      action_items: [],
      update_draft: null,
    });
    expect(coerceCallAnalysis('not an object').key_points).toEqual([]);
  });

  it('drops non-string and blank list entries and trims strings', () => {
    const result = coerceCallAnalysis({
      transcript: '  padded  ',
      summary: '   ',
      key_points: ['ok', '', 42, null, '  spaced  '],
      action_items: 'not-an-array',
      update_draft: 7,
    });

    expect(result.transcript).toBe('padded');
    expect(result.summary).toBeNull();
    expect(result.key_points).toEqual(['ok', 'spaced']);
    expect(result.action_items).toEqual([]);
    expect(result.update_draft).toBeNull();
  });
});

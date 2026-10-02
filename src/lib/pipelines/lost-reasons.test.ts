import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOST_REASONS,
  answeredLostReason,
  lostReasonLabel,
  lostReasonMissing,
  parseLostReason,
} from './lost-reasons';

describe('[TXW-025] lost reasons', () => {
  it('reuses a reason already answered in the deal form instead of asking again', () => {
    expect(answeredLostReason('Owner backed out', '  W&B dispute ')).toEqual({
      lost_reason: 'Owner backed out',
      lost_note: 'W&B dispute',
    });
    expect(answeredLostReason('Price disagreement', '')).toEqual({
      lost_reason: 'Price disagreement',
      lost_note: null,
    });
    expect(answeredLostReason(null, 'note')).toBeNull();
    expect(answeredLostReason('Other', '   ')).toBeNull();
  });

  it('accepts a listed reason with an optional note', () => {
    expect(parseLostReason({ lost_reason: 'Price disagreement' })).toEqual({
      ok: true,
      value: { lost_reason: 'Price disagreement', lost_note: null },
    });
    expect(
      parseLostReason({
        lost_reason: 'Owner backed out',
        lost_note: '  sold  ',
      })
    ).toEqual({
      ok: true,
      value: { lost_reason: 'Owner backed out', lost_note: 'sold' },
    });
  });

  it('asks for a note when the reason is Other', () => {
    expect(parseLostReason({ lost_reason: 'Other' }).ok).toBe(false);
    expect(
      parseLostReason({ lost_reason: 'Other', lost_note: 'Vastu' }).ok
    ).toBe(true);
  });

  it('refuses reasons that are not on the list and passes none through', () => {
    expect(parseLostReason({ lost_reason: 'Bored' }).ok).toBe(false);
    expect(parseLostReason({})).toEqual({ ok: true, value: null });
  });

  it('covers the three ways a deal can fail after the owner meeting', () => {
    expect(LOST_REASONS).toContain('Price disagreement');
    expect(LOST_REASONS).toContain('Terms disagreement');
    expect(LOST_REASONS).toContain('Owner backed out');
  });

  it('labels a lost deal with its reason and note', () => {
    expect(
      lostReasonLabel({ lost_reason: 'Buyer backed out', lost_note: 'loan' })
    ).toBe('Buyer backed out: loan');
    expect(lostReasonLabel({ lost_reason: null })).toBeNull();
  });
});

describe('[TXW-025] the mobile app offers exactly the reasons the server accepts', () => {
  it('keeps the native copy identical to this module', () => {
    const shared = (path: string) => {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      return source.slice(source.indexOf('export const LOST_REASONS'));
    };
    expect(shared('mobile/lib/lost-reasons.ts')).toBe(
      shared('src/lib/pipelines/lost-reasons.ts')
    );
  });

  it('requires a reason whenever a deal becomes lost', () => {
    expect(lostReasonMissing('lost', null)).toBe(true);
    expect(
      lostReasonMissing('lost', {
        lost_reason: 'Price disagreement',
        lost_note: null,
      })
    ).toBe(false);
    expect(lostReasonMissing('open', null)).toBe(false);
  });
});
